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
 * The manifest is a view, not a row: nothing a query can count is stored, so it
 * cannot drift from the replay it describes.
 */
export async function readManifest(db: Queryable, id: string): Promise<ReplayManifest | undefined> {
  const replay = (await db.query<ReplayRow>(REPLAY, [id])).rows[0]
  if (replay === undefined) return undefined

  const [lanes, datasets, crossings, frames] = await Promise.all([
    readLanes(db, id),
    readDatasets(db, id),
    countCrossings(db, id),
    countRadarFrames(db, id),
  ])
  const fleet = fleetOf(replay)
  const events = eventsIn(datasets, crossings)

  const assembled = {
    schemaVersion: 1,
    id,
    label: replay.label,
    extent: extentOf(replay),
    ...territoryOf(replay),
    ...aboutOf(replay),
    period: { from: replay.period_from, to: replay.period_to },
    createdAt: replay.created_at,
    updatedAt: replay.updated_at,
    state: replay.state,
    ...(replay.published_at === null ? {} : { publishedAt: replay.published_at }),
    lanes,
    datasets,
    media: {
      copied: replay.media_copied,
      failed: replay.media_failed,
      bytes: replay.media_bytes,
    },
    ...(fleet === undefined ? {} : { fleet }),
    ...(events === undefined ? {} : { events }),
    ...(datasets['radar-rainfall'] === undefined ? {} : { radarFrames: frames }),
    ...(replay.journal_error === null ? {} : { journalError: replay.journal_error }),
  }

  // Every reader opens the manifest first: serving a broken one as whole is worse than failing.
  const checked = replayManifestSchema.safeParse(assembled)
  if (!checked.success) throw new CorruptManifestError(id, { cause: checked.error })
  return checked.data
}

/** Decomposes a published manifest into the replay, its lanes and its reports. */
/* eslint-disable-next-line complexity -- eleven `?? null` and six optional chains, each a column
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
    manifest.territory ?? null,
    manifest.period.from,
    manifest.period.to,
    manifest.createdAt,
    manifest.updatedAt,
    manifest.state,
    manifest.journalError ?? null,
    manifest.media.copied,
    manifest.media.failed,
    manifest.media.bytes,
    manifest.fleet === undefined ? null : JSON.stringify(manifest.fleet),
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
  territory: string | null
  description: string | null
  phenomenon: string | null
  severity: string | null
  period_from: string
  period_to: string
  created_at: string
  updated_at: string
  state: string
  published_at: string | null
  journal_error: string | null
  media_copied: number
  media_failed: number
  media_bytes: number
  fleet: ReplayManifest['fleet'] | null
  min_lon: number | null
  min_lat: number | null
  max_lon: number | null
  max_lat: number | null
}

const REPLAY = `
  select label, territory, description, phenomenon, severity, period_from, period_to, created_at, updated_at, state, published_at,
         journal_error,
         media_copied, media_failed, media_bytes,
         fleet,
         ST_XMin(extent) as min_lon, ST_YMin(extent) as min_lat,
         ST_XMax(extent) as max_lon, ST_YMax(extent) as max_lat
    from replay where id = $1`

const UPSERT_REPLAY = `
  insert into replay (id, label, extent, territory, period_from, period_to, created_at,
                      updated_at, state, journal_error, media_copied, media_failed, media_bytes,
                      fleet)
  values ($1, $2,
          case when $3::double precision is null then null
               else ST_MakeEnvelope($3, $4, $5, $6, 4326) end,
          $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
  on conflict (id) do update set
    label = excluded.label, extent = excluded.extent, territory = excluded.territory,
    updated_at = excluded.updated_at,
    state = excluded.state, journal_error = excluded.journal_error,
    media_copied = excluded.media_copied, media_failed = excluded.media_failed,
    media_bytes = excluded.media_bytes,
    fleet = excluded.fleet`

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
 * A data set's count is the count of its own rows: `stations` holds both
 * families of the referential, and `radar-rainfall` counts series, not frames.
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
           when 'measured-stations' then (select count(*) from measured_station m
                                           where m.replay_id = d.replay_id)
           when 'events'           then (select count(*) from event e
                                           where e.replay_id = d.replay_id)
           when 'webcam-images'    then (select count(*) from webcam_image w
                                           where w.replay_id = d.replay_id)
           when 'radar-rainfall'   then (select count(*) from radar_series r
                                           where r.replay_id = d.replay_id)
           else 0
         end as count
    from replay_dataset d where d.replay_id = $1`

function territoryOf(row: ReplayRow): { territory?: string } {
  return row.territory === null ? {} : { territory: row.territory }
}

/** What the administrator said of it, each field left out when nothing was said. */
function aboutOf(row: ReplayRow): Record<string, string> {
  const about: Record<string, string> = {}
  if (row.description !== null) about.description = row.description
  if (row.phenomenon !== null) about.phenomenon = row.phenomenon
  if (row.severity !== null) about.severity = row.severity
  return about
}

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

/** The events the replay derived, apart from those agents reported in the same data set. */
async function countCrossings(db: Queryable, id: string): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `select count(*) as count from event where replay_id = $1 and origin = 'automatic'`,
    [id],
  )
  return rows.rows[0]?.count ?? 0
}

async function countRadarFrames(db: Queryable, id: string): Promise<number> {
  const rows = await db.query<{ count: number }>(
    'select count(*) as count from radar_frame where replay_id = $1',
    [id],
  )
  return rows.rows[0]?.count ?? 0
}

async function readDatasets(
  db: Queryable,
  id: string,
): Promise<Partial<Record<DatasetName, DatasetStatus>>> {
  const rows = (
    await db.query<{ name: DatasetName; report: Report; count: number }>(DATASETS, [id])
  ).rows

  return Object.fromEntries(rows.map((row) => [row.name, { count: row.count, report: row.report }]))
}

/**
 * The fleet, stored rather than counted, and absent until a lane collected a
 * referential: a measure does not carry the family `withMeasures` is counted by.
 */
function fleetOf(row: ReplayRow): ReplayManifest['fleet'] {
  return row.fleet ?? undefined
}

/**
 * What the replay's own data implied. The thresholds set aside and the
 * single-step crossings no count retrieves are read back from the derivation's
 * report.
 */
const EVENTS_REPORT = z.object({
  singleStep: z.number().int().nonnegative().catch(0),
  setAside: z.partialRecord(thresholdNatureSchema, z.number().int().nonnegative()).catch({}),
})

function eventsIn(
  datasets: Partial<Record<DatasetName, DatasetStatus>>,
  crossings: number,
): ReplayManifest['events'] {
  const stored = datasets.events
  if (stored === undefined) return undefined

  const summary = EVENTS_REPORT.safeParse(stored.report)
  return {
    crossings,
    singleStep: summary.success ? summary.data.singleStep : 0,
    thresholdsSetAside: summary.success ? summary.data.setAside : {},
  }
}
