import {
  rainGaugeSchema,
  stationSchema,
  webcamSchema,
  type RainGauge,
  type Station,
  type Webcam,
} from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'

/** The two families Aquasys numbers independently, kept apart by the key. */
const AQUASYS = ['hydro', 'rain-gauge']

const INSERT = `
  insert into source (replay_id, family, external_id, code, name, comment, town_code,
                      category, altitude, position, quantities, extra)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
          case when $10::double precision is null then null
               else ST_SetSRID(ST_MakePoint($10, $11), 4326) end,
          $12::jsonb, $13::jsonb)`

const SELECT = `
  select family, external_id, code, name, comment, town_code, category, altitude,
         ST_X(position) as lon, ST_Y(position) as lat, quantities, extra
    from source where replay_id = $1 and family = any($2::text[])`

type SourceRow = {
  family: string
  external_id: string
  code: string | null
  name: string | null
  comment: string | null
  town_code: string | null
  category: string | null
  altitude: number | null
  lon: number | null
  lat: number | null
  quantities: unknown
  extra: Record<string, unknown> | null
}

/**
 * The Aquasys referential: one object holding two families, stored as rows of
 * one table and read back in the shape the contract gives it.
 *
 * Written without being checked: what reaches the port has already passed its
 * contract. Read back through the contract, because storage is the one place a
 * value can arrive from outside the process.
 */
/* eslint-disable-next-line complexity -- eight of ten branches are an optional column becoming
   a SQL null; the other two are the two families sharing the table */
export async function writeReferential(
  db: Queryable,
  replayId: string,
  data: unknown,
): Promise<void> {
  const { stations, rainGauges } = data as { stations: Station[]; rainGauges: RainGauge[] }
  await db.query(`delete from source where replay_id = $1 and family = any($2::text[])`, [
    replayId,
    AQUASYS,
  ])

  for (const station of stations) {
    await db.query(INSERT, [
      replayId,
      'hydro',
      String(station.id),
      station.code,
      station.name,
      station.comment,
      station.townCode,
      station.category,
      station.altitude,
      station.position?.lon ?? null,
      station.position?.lat ?? null,
      JSON.stringify(station.quantities),
      null,
    ])
  }
  for (const gauge of rainGauges) {
    await db.query(INSERT, [
      replayId,
      'rain-gauge',
      String(gauge.id),
      gauge.code,
      gauge.name,
      gauge.comment,
      gauge.townCode,
      null,
      gauge.altitude,
      gauge.position?.lon ?? null,
      gauge.position?.lat ?? null,
      JSON.stringify(gauge.quantities),
      null,
    ])
  }
}

export async function readReferential(
  db: Queryable,
  replayId: string,
): Promise<{ stations: Station[]; rainGauges: RainGauge[] }> {
  const rows = (await db.query<SourceRow>(SELECT, [replayId, AQUASYS])).rows

  return {
    stations: rows
      .filter((row) => row.family === 'hydro')
      .map((row) => stationSchema.parse({ ...common(row), category: row.category }))
      .sort((one, other) => one.id - other.id),
    rainGauges: rows
      .filter((row) => row.family === 'rain-gauge')
      .map((row) => rainGaugeSchema.parse(common(row)))
      .sort((one, other) => one.id - other.id),
  }
}

/** What a station and a rain gauge spell the same way. */
function common(row: SourceRow) {
  return {
    id: Number(row.external_id),
    code: row.code,
    name: row.name,
    comment: row.comment,
    townCode: row.town_code,
    altitude: row.altitude,
    position: positionOf(row),
    quantities: row.quantities,
  }
}

export async function writeWebcams(db: Queryable, replayId: string, data: unknown): Promise<void> {
  const webcams = data as Webcam[]
  await db.query(`delete from source where replay_id = $1 and family = 'webcam'`, [replayId])

  for (const webcam of webcams) {
    await db.query(INSERT, [
      replayId,
      'webcam',
      webcam.code,
      webcam.code,
      // A webcam has no name of its own: what names it is its commune, which
      // goes where the other family-specific fields go.
      null,
      null,
      null,
      null,
      null,
      webcam.position.lon,
      webcam.position.lat,
      null,
      JSON.stringify({
        commune: webcam.commune,
        url: webcam.url,
        operational: webcam.operational,
      }),
    ])
  }
}

export async function readWebcams(db: Queryable, replayId: string): Promise<Webcam[]> {
  const rows = (await db.query<SourceRow>(SELECT, [replayId, ['webcam']])).rows

  return rows
    .map((row) =>
      webcamSchema.parse({
        code: row.external_id,
        commune: row.extra?.commune,
        url: row.extra?.url,
        operational: row.extra?.operational,
        position: positionOf(row),
      }),
    )
    .sort((one, other) => one.code.localeCompare(other.code))
}

function positionOf(row: SourceRow): { lon: number; lat: number } | null {
  return row.lon === null || row.lat === null ? null : { lon: row.lon, lat: row.lat }
}
