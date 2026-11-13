import {
  rainGaugeSchema,
  stationSchema,
  webcamSchema,
  type RainGauge,
  type Station,
  type Webcam,
} from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'
import { insertRows } from './batch.ts'

/** The two families Aquasys numbers independently, kept apart by the key. */
const AQUASYS = ['hydro', 'rain-gauge']

const INSERT = `
  insert into source (replay_id, family, external_id, code, name, comment, town_code,
                      category, altitude, lon, lat, quantities, extra)
  select $1, r.family, r.external_id, r.code, r.name, r.comment, r.town_code, r.category,
         r.altitude, r.lon, r.lat, r.quantities, r.extra
    from jsonb_to_recordset($2::jsonb) as r(family text, external_id text, code text,
         name text, comment text, town_code text, category text, altitude double precision,
         lon double precision, lat double precision, quantities jsonb, extra jsonb)`

/** A row of `source`, as the statement above reads it. */
type SourceInsert = {
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

const SELECT = `
  select family, external_id, code, name, comment, town_code, category, altitude,
         lon, lat, quantities, extra
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
 * one table, written unchecked and read back through the contract.
 */
export async function writeReferential(
  db: Queryable,
  replayId: string,
  data: unknown,
): Promise<void> {
  const { stations, rainGauges } = data as { stations: Station[]; rainGauges: RainGauge[] }
  await insertRows(db, INSERT, replayId, [
    ...stations.map((station): SourceInsert => ({
      ...aquasysRow('hydro', station),
      category: station.category,
      extra: { ngfDatum: station.ngfDatum, levelDatum: station.levelDatum },
    })),
    ...rainGauges.map((gauge): SourceInsert => ({
      ...aquasysRow('rain-gauge', gauge),
      category: null,
      extra: null,
    })),
  ])
}

/** What a station and a rain gauge write the same way. */
function aquasysRow(
  family: string,
  source: Station | RainGauge,
): Omit<SourceInsert, 'category' | 'extra'> {
  return {
    family,
    external_id: String(source.id),
    code: source.code,
    name: source.name,
    comment: source.comment,
    town_code: source.townCode,
    altitude: source.altitude,
    lon: source.position?.lon ?? null,
    lat: source.position?.lat ?? null,
    quantities: source.quantities,
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
      .map((row) =>
        stationSchema.parse({
          ...common(row),
          category: row.category,
          ngfDatum: row.extra?.ngfDatum ?? null,
          levelDatum: row.extra?.levelDatum,
        }),
      )
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
  await insertRows(
    db,
    INSERT,
    replayId,
    webcams.map((webcam): SourceInsert => ({
      family: 'webcam',
      external_id: webcam.code,
      code: webcam.code,
      // A webcam is named by its commune, kept with its other own fields.
      name: null,
      comment: null,
      town_code: null,
      category: null,
      altitude: null,
      lon: webcam.position.lon,
      lat: webcam.position.lat,
      quantities: null,
      extra: { commune: webcam.commune, url: webcam.url, operational: webcam.operational },
    })),
  )
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
