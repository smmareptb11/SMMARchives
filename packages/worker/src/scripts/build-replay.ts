import type { Pool } from 'pg'

import {
  ExitCode,
  aquasysConfig,
  databaseConfig,
  lizmapConfig,
  mediaConfig,
  radarRainfallConfig,
  type ReplayIdentity,
  type ReplayManifest,
} from '@smmarchives/shared'

import {
  UsageError,
  parseCliArgs,
  progress,
  runProcess,
  toExtent,
  toReplayId,
  toTerritory,
  toWindow,
} from '../cli.ts'
import { openPool } from '../db/pool.ts'
import { buildReplay } from '../replay/build.ts'
import { openPostgresCatalog } from '../replay/postgres/catalog.ts'
import type { ReplayStore } from '../replay/store.ts'
import { AquasysClient } from '../sources/aquasys/client.ts'
import { LizmapClient } from '../sources/lizmap/client.ts'

await runProcess(async () => {
  const args = parseCliArgs({
    id: { type: 'string' },
    label: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    bbox: { type: 'string' },
    territory: { type: 'string' },
  })

  const extent = toExtent(args.bbox)
  const territory = toTerritory(args.territory, extent)
  const asked = {
    label: args.label ?? null,
    extent: extent ?? null,
    ...(territory === undefined ? {} : { territory }),
    period: toWindow(args.from, args.to),
  }

  const pool = openPool(databaseConfig().url)
  try {
    return await build(pool, args.id, asked)
  } finally {
    // Closed whatever happened: an open pool holds the process alive until its
    // connections time out, and the API — which waits a few seconds to hear
    // whether this command could start at all — would call a build that died
    // in two seconds one that is still running.
    await pool.end()
  }
})

async function build(
  pool: Pool,
  askedId: string | undefined,
  asked: Omit<ReplayIdentity, 'id'>,
): Promise<ExitCode> {
  const catalog = openPostgresCatalog({
    pool,
    mediaRoot: mediaConfig().root,
    onProgress: progress,
  })

  // Without `--id` the database mints one. With it, the build goes into the
  // replay the API has just created, which no build has taken yet: a replay is
  // frozen once built.
  const { id, store } = await openOrCreate(catalog, askedId, asked)
  if (!(await store.claim())) {
    throw new UsageError(`--id ${id} names a replay a build has already started`)
  }
  const identity: ReplayIdentity = { id, ...asked }
  const stopListening = abandonOnSignal(store)

  try {
    progress(`replay ${identity.id}, ${identity.period.from} → ${identity.period.to}…`)
    const radarRainfall = radarSource()
    const { manifest, exitCode } = await buildReplay({
      identity,
      store,
      aquasys: { client: new AquasysClient({ config: aquasysConfig() }) },
      lizmap: {
        client: new LizmapClient({ config: lizmapConfig() }),
        // The images sit on another host, reached without the Lizmap's spacing.
        fetch: globalThis.fetch,
      },
      ...(radarRainfall === undefined ? {} : { radarRainfall }),
      copyMedia: true,
      onProgress: progress,
    })

    summarise(manifest)
    return exitCode
  } catch (error) {
    await abandon(store)
    throw error
  } finally {
    stopListening()
  }
}

/**
 * Marks the replay failed, as far as the database still answers.
 *
 * Left `running`, a replay nobody builds any more refuses its events and its
 * publication for good. The failure to mark it is said, never raised: the
 * error that stopped the build is the one worth reading.
 */
async function abandon(store: ReplayStore): Promise<void> {
  try {
    await store.abandon()
  } catch (error) {
    progress(`  the replay could not be marked failed: ${String(error)}`)
  }
}

/**
 * Abandons the replay when the process is told to stop, as a container is when
 * it is replaced. A `SIGKILL` cannot be caught, and leaves it `running`.
 */
function abandonOnSignal(store: ReplayStore): () => void {
  const onSignal = (signal: NodeJS.Signals) => {
    progress(`${signal}: build interrupted`)
    void abandon(store).finally(() => process.exit(ExitCode.failure))
  }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  return () => {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
  }
}

/** The replay to build into, named or minted. */
async function openOrCreate(
  catalog: ReturnType<typeof openPostgresCatalog>,
  asked: string | undefined,
  identity: Omit<ReplayIdentity, 'id'>,
) {
  if (asked === undefined) return catalog.create(identity)

  const id = toReplayId(asked)
  const store = await catalog.open(id)
  if (store === undefined) throw new UsageError(`--id ${id} names no replay`)
  return { id, store }
}

/**
 * The delivered rasters, or nothing when none are configured.
 *
 * The delivery directory exists only once Predict has delivered, and a site
 * waiting for its first delivery still has a replay to build. A root that is
 * set but unreadable is a lane that fails.
 */
function radarSource() {
  const config = radarRainfallConfig()
  if (config === undefined) progress('  radar-rainfall: no delivery root configured, lane not run')
  return config
}

/** What the run produced, before the exit code says only whether it is whole. */
/* eslint-disable-next-line complexity -- one conditional per note the summary may or may not
   print, and two loops over what the build held */
function summarise(manifest: ReplayManifest): void {
  progress(`replay ${manifest.id}: ${manifest.state}`)

  for (const [name, dataset] of Object.entries(manifest.datasets)) {
    const notes = [
      dataset.report.fallbacks.length > 0 ? `${dataset.report.fallbacks.length} fallback(s)` : '',
      dataset.report.failures.length > 0 ? `${dataset.report.failures.length} failure(s)` : '',
    ].filter(Boolean)
    progress(
      `  ${name}  ${dataset.count} entries${notes.length > 0 ? `, ${notes.join(', ')}` : ''}`,
    )
  }

  const { copied, failed } = manifest.media
  if (copied + failed > 0) {
    progress(`  media  ${copied} copied, ${failed} failed`)
  }

  for (const [name, lane] of Object.entries(manifest.lanes)) {
    if (lane.state === 'failed') progress(`  failed  ${name}: ${lane.error ?? 'no reason given'}`)
  }
}
