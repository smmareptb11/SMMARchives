import type { Pool } from 'pg'

import {
  aquasysConfig,
  databaseConfig,
  lizmapConfig,
  mediaConfig,
  optionalRadarRainfallConfig,
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
  toLanes,
  toReplayId,
  toWindow,
  type CollectingLane,
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
    dir: { type: 'string' },
    delivery: { type: 'string', multiple: true },
    only: { type: 'string', multiple: true },
    'no-media': { type: 'boolean', default: false },
  })

  const asked = {
    label: args.label ?? null,
    extent: toExtent(args.bbox) ?? null,
    period: toWindow(args.from, args.to),
  }

  const only = toLanes(args.only)
  const pool = openPool(databaseConfig().url)
  try {
    return await build(pool, args, asked, only)
  } finally {
    // Closed whatever happened: an open pool holds the process alive until its
    // connections time out, and the API — which waits a few seconds to hear
    // whether this command could start at all — would call a build that died
    // in two seconds one that is still running.
    await pool.end()
  }
})

type BuildArgs = {
  id?: string | undefined
  dir?: string | undefined
  delivery?: string[] | undefined
  /** The raw flag, beside the lanes derived from it: absent means by default. */
  only?: string[] | undefined
  'no-media': boolean
}

async function build(
  pool: Pool,
  args: BuildArgs,
  asked: Omit<ReplayIdentity, 'id'>,
  only: Set<CollectingLane>,
): Promise<ExitCode> {
  const catalog = openPostgresCatalog({
    pool,
    mediaRoot: mediaConfig().root,
    onProgress: progress,
  })

  // Without `--id` the database mints one, which is the ordinary way to build.
  // With it, the build goes into a replay that already exists: a re-run repairs
  // a lane without costing the others.
  const { id, store } = await openOrCreate(catalog, args.id, asked)
  const identity: ReplayIdentity = { id, ...asked }

  progress(`replay ${identity.id}, ${identity.period.from} → ${identity.period.to}…`)
  const radarRainfall = only.has('radar-rainfall')
    ? radarSource(args.dir, args.delivery, args.only !== undefined)
    : undefined
  const { manifest, exitCode } = await buildReplay({
    identity,
    store,
    // Read the configuration of a source only when its lane is asked for: a
    // replay of the delivered rasters must not require an Aquasys token.
    ...(only.has('aquasys')
      ? { aquasys: { client: new AquasysClient({ config: aquasysConfig() }) } }
      : {}),
    ...(only.has('lizmap')
      ? {
          lizmap: {
            client: new LizmapClient({ config: lizmapConfig() }),
            // The images sit on another host, reached without the Lizmap's
            // spacing.
            fetch: globalThis.fetch,
          },
        }
      : {}),
    ...(radarRainfall === undefined ? {} : { radarRainfall }),
    copyMedia: !args['no-media'],
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
 * Named — by `--only radar-rainfall` or by a `--dir` — an unconfigured root is
 * an error: what was asked for is refused, not quietly dropped. Taken with the
 * other lanes by default it is not, because the delivery directory exists only
 * once Predict has delivered, and a site waiting for its first delivery still
 * has a replay to build. A root that is set but unreadable stays a lane that
 * fails, whichever way it got here.
 */
function radarSource(dir: string | undefined, deliveries: string[] | undefined, named: boolean) {
  const config = named
    ? radarRainfallConfig(process.env, { root: dir })
    : optionalRadarRainfallConfig(process.env, { root: dir })
  if (config === undefined) {
    progress('  radar-rainfall: no delivery root configured, lane not run')
    return undefined
  }
  return { root: config.root, rasterExtent: config.extent, deliveries }
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
