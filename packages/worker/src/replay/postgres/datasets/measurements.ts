import { measureSchema, thresholdSchema, type Measure, type Threshold } from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'

export async function writeThresholds(
  db: Queryable,
  replayId: string,
  data: unknown,
): Promise<void> {
  const thresholds = data as Threshold[]
  await db.query('delete from threshold where replay_id = $1', [replayId])

  for (const threshold of thresholds) {
    await db.query(
      `insert into threshold (replay_id, station_id, quantity, threshold_id, label, value,
                              nature, nature_is_fallback, color)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        replayId,
        String(threshold.stationId),
        threshold.quantity,
        threshold.id,
        threshold.label,
        threshold.value,
        threshold.nature,
        threshold.natureIsFallback,
        threshold.color,
      ],
    )
  }
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
         from threshold where replay_id = $1 order by station_id, quantity, value`,
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
 * seconds into minutes. The conflict clause is the re-run rule — one reading
 * per source, quantity and instant, the newer value replacing the older.
 */
const BATCH = 1_000

export async function writeMeasures(db: Queryable, replayId: string, data: unknown): Promise<void> {
  const measures = data as Measure[]
  await db.query('delete from measure where replay_id = $1', [replayId])

  for (let start = 0; start < measures.length; start += BATCH) {
    const batch = measures.slice(start, start + BATCH)
    await db.query(
      `insert into measure (replay_id, source_id, quantity, at, value)
       select $1, u.source_id, u.quantity, u.at, u.value
         from unnest($2::text[], $3::text[], $4::timestamptz[], $5::double precision[])
              as u(source_id, quantity, at, value)
       on conflict (replay_id, source_id, quantity, at) do update set value = excluded.value`,
      [
        replayId,
        batch.map((one) => String(one.sourceId)),
        batch.map((one) => one.quantity),
        batch.map((one) => one.at),
        batch.map((one) => one.value),
      ],
    )
  }
}

export type MeasureFilter = {
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
  if (filter.source !== undefined) where.push(`source_id = $${values.push(filter.source)}`)
  if (filter.quantity !== undefined) where.push(`quantity = $${values.push(filter.quantity)}`)
  if (filter.from !== undefined) where.push(`at >= $${values.push(filter.from)}`)
  if (filter.to !== undefined) where.push(`at <= $${values.push(filter.to)}`)

  const rows = (
    await db.query<{ source_id: string; quantity: string; at: string; value: number }>(
      `select source_id, quantity, at, value from measure
        where ${where.join(' and ')} order by source_id, quantity, at`,
      values,
    )
  ).rows

  return rows.map((row) =>
    measureSchema.parse({
      sourceId: Number(row.source_id),
      quantity: row.quantity,
      at: row.at,
      value: row.value,
    }),
  )
}
