import { z } from 'zod'

import {
  replayManifestSchema,
  thresholdNatureSchema,
  type BoundingBox,
  type DatasetName,
  type DatasetStatus,
  type LaneName,
  type Report,
  type ReplayManifest,
} from '@smmarchives/shared'

import type { Queryable } from '../../db/tx.ts'
import { CorruptManifestError } from '../store.ts'

/**
 * The manifest is a view, not a row.
 *
 * Nothing is stored that a query rebuilds: what a data set holds, the fleet and
 * how much of it spoke are counted from the tables that hold them, so a manifest
 * cannot drift from the replay it describes. Only what records what did *not*
 * happen has columns — media skipped, media failed, the bytes copied — because
 * no count retrieves those.
 */
export async function readManifest(db: Queryable, id: string): Promise<ReplayManifest | undefined> {
  const replay = (await db.query<ReplayRow>(REPLAY, [id])).rows[0]
  if (replay === undefined) return undefined

  const [lanes, { datasets, crossings }] = await Promise.all([
    readLanes(db, id),
    readDatasets(db, id),
  ])
  const fleet = fleetOf(replay)
  const events = eventsIn(datasets, crossings, lanes)

  const assembled = {
    schemaVersion: 1,
    id,
    label: replay.label,
    extent: extentOf(replay),
    period: { from: replay.period_from, to: replay.period_to },
    createdAt: replay.created_at,
    updatedAt: replay.updated_at,
    state: replay.state,
    lanes,
    datasets,
    media: {
      copied: replay.media_copied,
      skipped: replay.media_skipped,
      failed: replay.media_failed,
      bytes: replay.media_bytes,
    },
    ...(fleet === undefined ? {} : { fleet }),
    ...(events === undefined ? {} : { events }),
    ...(replay.journal_error === null ? {} : { journalError: replay.journal_error }),
  }

  // Checked like the file was, and for the same reason: the manifest is the
  // index every reader opens first, and serving a broken one as if it were
  // whole is worse than failing.
  const checked = replayManifestSchema.safeParse(assembled)
  if (!checked.success) throw new CorruptManifestError(id, { cause: checked.error })
  return checked.data
}

/** Decomposes a published manifest into the replay, its lanes and its reports. */
/* eslint-disable-next-line complexity -- ten `?? null` and six optional chains, each a column
   SQL may find absent, plus the two loops; not one of them is a decision */
export async function writeManifest(db: Queryable, manifest: ReplayManifest): Promise<void> {
  const extent = manifest.extent
  await db.query(UPSERT_REPLAY, [
    manifest.id,
    manifest.label,
    extent?.minLon ?? null,
    extent?.minLat ?? null,
    extent?.maxLon ?? null,
    extent?.maxLat ?? null,
    manifest.period.from,
    manifest.period.to,
    manifest.createdAt,
    manifest.updatedAt,
    manifest.state,
    manifest.journalError ?? null,
    manifest.media.copied,
    manifest.media.skipped,
    manifest.media.failed,
    manifest.media.bytes,
    manifest.fleet?.inExtent ?? null,
    manifest.fleet?.withMeasures ?? null,
  ])

  for (const [name, lane] of Object.entries(manifest.lanes)) {
    await db.query(UPSERT_LANE, [
      manifest.id,
      name,
      lane.state,
      lane.startedAt ?? null,
      lane.finishedAt ?? null,
      lane.error ?? null,
    ])
  }
  for (const [name, dataset] of Object.entries(manifest.datasets)) {
    await db.query(UPSERT_DATASET, [manifest.id, name, JSON.stringify(dataset.report)])
  }
}

type ReplayRow = {
  label: string | null
  period_from: string
  period_to: string
  created_at: string
  updated_at: string
  state: string
  journal_error: string | null
  media_copied: number
  media_skipped: number
  media_failed: number
  media_bytes: number
  fleet_in_extent: number | null
  fleet_with_measures: number | null
  min_lon: number | null
  min_lat: number | null
  max_lon: number | null
  max_lat: number | null
}

const REPLAY = `
  select label, period_from, period_to, created_at, updated_at, state, journal_error,
         media_copied, media_skipped, media_failed, media_bytes,
         fleet_in_extent, fleet_with_measures,
         ST_XMin(extent) as min_lon, ST_YMin(extent) as min_lat,
         ST_XMax(extent) as max_lon, ST_YMax(extent) as max_lat
    from replay where id = $1`

// The later of the two dates of update, never the one published alone: a
// build publishes the manifest it holds in memory, and an event an agent added
// meanwhile stamped a later one, which this would otherwise move back.
const UPSERT_REPLAY = `
  insert into replay (id, label, extent, period_from, period_to, created_at, updated_at,
                      state, journal_error, media_copied, media_skipped, media_failed,
                      media_bytes, fleet_in_extent, fleet_with_measures)
  values ($1, $2,
          case when $3::double precision is null then null
               else ST_MakeEnvelope($3, $4, $5, $6, 4326) end,
          $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  on conflict (id) do update set
    label = excluded.label, extent = excluded.extent,
    updated_at = greatest(replay.updated_at, excluded.updated_at),
    state = excluded.state, journal_error = excluded.journal_error,
    media_copied = excluded.media_copied, media_skipped = excluded.media_skipped,
    media_failed = excluded.media_failed, media_bytes = excluded.media_bytes,
    fleet_in_extent = excluded.fleet_in_extent,
    fleet_with_measures = excluded.fleet_with_measures`

const UPSERT_LANE = `
  insert into replay_lane (replay_id, name, state, started_at, finished_at, error)
  values ($1, $2, $3, $4, $5, $6)
  on conflict (replay_id, name) do update set
    state = excluded.state, started_at = excluded.started_at,
    finished_at = excluded.finished_at, error = excluded.error`

const UPSERT_DATASET = `
  insert into replay_dataset (replay_id, name, report) values ($1, $2, $3::jsonb)
  on conflict (replay_id, name) do update set report = excluded.report`

// `updated_at` is left alone here: it stamps the rows of a data set, not the
// report a publication carries about them.

/**
 * A data set's count is the count of its own rows, told here once.
 *
 * `stations` holds two families because the referential is one object holding
 * both, and `radar-rainfall` counts series rather than frames, because that is
 * what the data set is an array of.
 */
const DATASETS = `
  select d.name, d.report,
         case d.name
           when 'stations'         then (select count(*) from source s
                                           where s.replay_id = d.replay_id
                                             and s.family in ('hydro', 'rain-gauge'))
           when 'webcams'          then (select count(*) from source s
                                           where s.replay_id = d.replay_id and s.family = 'webcam')
           when 'thresholds'       then (select count(*) from threshold t
                                           where t.replay_id = d.replay_id)
           when 'measures'         then (select count(*) from measure m
                                           where m.replay_id = d.replay_id)
           when 'events'           then (select count(*) from event e
                                           where e.replay_id = d.replay_id)
           when 'reference-layers' then (select count(distinct layer) from reference_feature f
                                           where f.replay_id = d.replay_id)
           when 'webcam-images'    then (select count(*) from webcam_image w
                                           where w.replay_id = d.replay_id)
           when 'radar-rainfall'   then (select count(*) from radar_series r
                                           where r.replay_id = d.replay_id)
           else 0
         end as count,
         -- The crossings apart from the data set, which holds what agents
         -- wrote as well.
         case d.name
           when 'events' then (select count(*) from event e
                                where e.replay_id = d.replay_id and e.origin = 'automatic')
         end as crossings
    from replay_dataset d where d.replay_id = $1`

function extentOf(row: ReplayRow): BoundingBox | null {
  if (row.min_lon === null || row.min_lat === null) return null
  if (row.max_lon === null || row.max_lat === null) return null
  return { minLon: row.min_lon, minLat: row.min_lat, maxLon: row.max_lon, maxLat: row.max_lat }
}

async function readLanes(db: Queryable, id: string): Promise<Partial<Record<LaneName, unknown>>> {
  const rows = (
    await db.query<{
      name: string
      state: string
      started_at: string | null
      finished_at: string | null
      error: string | null
    }>(
      `select name, state, started_at, finished_at, error
         from replay_lane where replay_id = $1`,
      [id],
    )
  ).rows

  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      {
        state: row.state,
        ...(row.started_at === null ? {} : { startedAt: row.started_at }),
        ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
        ...(row.error === null ? {} : { error: row.error }),
      },
    ]),
  )
}

async function readDatasets(
  db: Queryable,
  id: string,
): Promise<{ datasets: Partial<Record<DatasetName, DatasetStatus>>; crossings: number }> {
  const rows = (
    await db.query<{
      name: DatasetName
      report: Report
      count: number
      crossings: number | null
    }>(DATASETS, [id])
  ).rows

  return {
    datasets: Object.fromEntries(
      rows.map((row) => [row.name, { count: row.count, report: row.report }]),
    ),
    crossings: rows.find((row) => row.name === 'events')?.crossings ?? 0,
  }
}

/**
 * The fleet, stored rather than counted, and absent until a lane collected a
 * referential — which is what its own contract says.
 *
 * `withMeasures` is the exception to counting everything countable: the lane
 * sums it per family, and a measure does not carry the family that would let it
 * be recounted. See `measure` in the schema.
 */
function fleetOf(row: ReplayRow): ReplayManifest['fleet'] {
  if (row.fleet_in_extent === null || row.fleet_with_measures === null) return undefined
  return { inExtent: row.fleet_in_extent, withMeasures: row.fleet_with_measures }
}

/**
 * What the replay's own data implied, rebuilt rather than stored.
 *
 * The thresholds set aside and the single-step crossings are build facts no
 * count over the events retrieves — and the derivation already writes them in
 * its own report, which is where they are read back from.
 *
 * Absent while no build ever ran the lane that derives them, even when an
 * agent's event made the data set exist: asked of the lane, which is what
 * knows, and not guessed from the shape of a report. Whatever state that lane
 * is in, the crossings a previous run stored are still there and summarised:
 * a re-run under way, or one whose derivation failed, leaves them in place.
 */
const EVENTS_REPORT = z.object({
  singleStep: z.number().int().nonnegative().catch(0),
  setAside: z.partialRecord(thresholdNatureSchema, z.number().int().nonnegative()).catch({}),
})

function eventsIn(
  datasets: Partial<Record<DatasetName, DatasetStatus>>,
  crossings: number,
  lanes: Partial<Record<LaneName, unknown>>,
): ReplayManifest['events'] {
  const stored = datasets.events
  if (stored === undefined || lanes.events === undefined) return undefined

  const summary = EVENTS_REPORT.safeParse(stored.report)
  return {
    crossings,
    singleStep: summary.success ? summary.data.singleStep : 0,
    thresholdsSetAside: summary.success ? summary.data.setAside : {},
  }
}
