import {
  measureSchema,
  measuredStationsSchema,
  thresholdSchema,
  type Measure,
  type Threshold,
} from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'
import { insertRows } from './batch.ts'

export async function writeThresholds(
  db: Queryable,
  replayId: string,
  data: unknown,
): Promise<void> {
  const thresholds = data as Threshold[]
  await insertRows(
    db,
    `insert into threshold (replay_id, station_id, quantity, threshold_id, label, value,
                            nature, nature_is_fallback, color)
     select $1, r.station_id, r.quantity, r.threshold_id, r.label, r.value,
            r.nature, r.nature_is_fallback, r.color
       from jsonb_to_recordset($2::jsonb) as r(station_id text, quantity text,
            threshold_id integer, label text, value double precision, nature text,
            nature_is_fallback boolean, color text)`,
    replayId,
    thresholds.map((threshold) => ({
      station_id: String(threshold.stationId),
      quantity: threshold.quantity,
      threshold_id: threshold.id,
      label: threshold.label,
      value: threshold.value,
      nature: threshold.nature,
      nature_is_fallback: threshold.natureIsFallback,
      color: threshold.color,
    })),
  )
}

export async function readThresholds(db: Queryable, replayId: string): Promise<Threshold[]> {
  const rows = (
    await db.query<{
      station_id: string
      quantity: string
      threshold_id: number
      label: string
      value: number
      nature: string
      nature_is_fallback: boolean
      color: string | null
    }>(
      `select station_id, quantity, threshold_id, label, value, nature, nature_is_fallback, color
         from threshold where replay_id = $1 order by station_id::integer, quantity, value`,
      [replayId],
    )
  ).rows

  return rows.map((row) =>
    thresholdSchema.parse({
      stationId: Number(row.station_id),
      id: row.threshold_id,
      label: row.label,
      quantity: row.quantity,
      value: row.value,
      nature: row.nature,
      natureIsFallback: row.nature_is_fallback,
      color: row.color,
    }),
  )
}

/**
 * What a station or a rain gauge read, and when.
 *
 * Inserted in one statement per batch rather than one per measure: a replay of
 * three days holds around 160 000 of them, and a round trip each would turn
 * seconds into minutes. One reading per source, quantity and instant is the
 * collection's rule to keep: a second one is refused by the primary key.
 */
const BATCH = 1_000

export async function writeMeasures(db: Queryable, replayId: string, data: unknown): Promise<void> {
  const measures = data as Measure[]
  for (let start = 0; start < measures.length; start += BATCH) {
    const batch = measures.slice(start, start + BATCH)
    await db.query(
      `insert into measure (replay_id, family, source_id, quantity, at, value)
       select $1, u.family, u.source_id, u.quantity, u.at, u.value
         from unnest($2::text[], $3::text[], $4::text[], $5::timestamptz[],
                     $6::double precision[])
              as u(family, source_id, quantity, at, value)`,
      [
        replayId,
        batch.map((one) => one.family),
        batch.map((one) => String(one.sourceId)),
        batch.map((one) => one.quantity),
        batch.map((one) => one.at),
        batch.map((one) => one.value),
      ],
    )
  }
}

export type MeasureFilter = {
  family?: string | undefined
  source?: string | undefined
  quantity?: string | undefined
  from?: string | undefined
  to?: string | undefined
}

export async function readMeasures(
  db: Queryable,
  replayId: string,
  filter: MeasureFilter = {},
): Promise<Measure[]> {
  const where = ['replay_id = $1']
  const values: unknown[] = [replayId]

  // Parameterised, never interpolated: a filter's value comes from a request.
  if (filter.family !== undefined) where.push(`family = $${values.push(filter.family)}`)
  if (filter.source !== undefined) where.push(`source_id = $${values.push(filter.source)}`)
  if (filter.quantity !== undefined) where.push(`quantity = $${values.push(filter.quantity)}`)
  if (filter.from !== undefined) where.push(`at >= $${values.push(filter.from)}`)
  if (filter.to !== undefined) where.push(`at <= $${values.push(filter.to)}`)

  const rows = (
    await db.query<{
      family: string
      source_id: string
      quantity: string
      at: string
      value: number
    }>(
      `select family, source_id, quantity, at, value from measure
        where ${where.join(' and ')} order by family, source_id::integer, quantity, at`,
      values,
    )
  ).rows

  return rows.map((row) =>
    measureSchema.parse({
      family: row.family,
      sourceId: Number(row.source_id),
      quantity: row.quantity,
      at: row.at,
      value: row.value,
    }),
  )
}

export async function writeMeasuredStations(
  db: Queryable,
  replayId: string,
  data: unknown,
): Promise<void> {
  const stations = data as number[]
  await db.query(
    `insert into measured_station (replay_id, station_id)
     select $1, u.station_id from unnest($2::text[]) as u(station_id)`,
    [replayId, stations.map(String)],
  )
}

export async function readMeasuredStations(db: Queryable, replayId: string): Promise<number[]> {
  const rows = (
    await db.query<{ station_id: string }>(
      'select station_id from measured_station where replay_id = $1',
      [replayId],
    )
  ).rows

  return measuredStationsSchema.parse(
    rows.map((row) => Number(row.station_id)).sort((one, other) => one - other),
  )
}
