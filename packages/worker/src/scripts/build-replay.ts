import type { Pool } from 'pg'

import {
  aquasysConfig,
  databaseConfig,
  lizmapConfig,
  mediaConfig,
  radarRainfallConfig,
  type ExitCode,
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
  toWindow,
} from '../cli.ts'
import { openPool } from '../db/pool.ts'
import { buildReplay } from '../replay/build.ts'
import { openPostgresCatalog } from '../replay/postgres/catalog.ts'
import { AquasysClient } from '../sources/aquasys/client.ts'
import { LizmapClient } from '../sources/lizmap/client.ts'

await runProcess(async () => {
  const args = parseCliArgs({
    id: { type: 'string' },
    label: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    bbox: { type: 'string' },
  })

  const asked = {
    label: args.label ?? null,
    extent: toExtent(args.bbox) ?? null,
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

  // Without `--id` the database mints one, which is the ordinary way to build.
  // With it, the build goes into a replay that already exists: a re-run repairs
  // a lane without costing the others.
  const { id, store } = await openOrCreate(catalog, askedId, asked)
  const identity: ReplayIdentity = { id, ...asked }

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
  if (config === undefined) {
    progress('  radar-rainfall: no delivery root configured, lane not run')
    return undefined
  }
  return { root: config.root, rasterExtent: config.extent }
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

  const { copied, skipped, failed } = manifest.media
  if (copied + skipped + failed > 0) {
    progress(`  media  ${copied} copied, ${skipped} already there, ${failed} failed`)
  }

  for (const [name, lane] of Object.entries(manifest.lanes)) {
    if (lane.state === 'failed') progress(`  failed  ${name}: ${lane.error ?? 'no reason given'}`)
  }
}
