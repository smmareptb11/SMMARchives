import { eventSchema, type ReplayEvent } from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'

/**
 * Replaces what the derivation found, and nothing an agent wrote.
 *
 * A re-run derives every crossing again, so the automatic rows are cleared
 * first; the manual ones exist nowhere else, and a rebuild that took them
 * would lose them for good.
 */
export async function writeEvents(db: Queryable, replayId: string, data: unknown): Promise<void> {
  const events = data as ReplayEvent[]
  await db.query(`delete from event where replay_id = $1 and origin = 'automatic'`, [replayId])

  for (const event of events) {
    await db.query(
      `insert into event (replay_id, id, origin, category, title, severity, color,
                          starts_at, ends_at, position, source_id, media, crossing)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               case when $10::double precision is null then null
                    else ST_SetSRID(ST_MakePoint($10, $11), 4326) end,
               $12, $13::text[], $14::jsonb)`,
      [
        replayId,
        event.id,
        event.origin,
        event.category,
        event.title,
        event.severity,
        event.color,
        event.from,
        event.to,
        event.position?.lon ?? null,
        event.position?.lat ?? null,
        event.sourceId === null ? null : String(event.sourceId),
        event.media,
        JSON.stringify(event.crossing),
      ],
    )
  }
}

export async function readEvents(db: Queryable, replayId: string): Promise<ReplayEvent[]> {
  const rows = (
    await db.query<{
      id: string
      origin: string
      category: string
      title: string
      severity: number | null
      color: string | null
      starts_at: string
      ends_at: string | null
      lon: number | null
      lat: number | null
      source_id: string | null
      media: string[]
      crossing: unknown
    }>(
      `select id, origin, category, title, severity, color, starts_at, ends_at,
              ST_X(position) as lon, ST_Y(position) as lat, source_id, media, crossing
         from event where replay_id = $1 order by starts_at, id`,
      [replayId],
    )
  ).rows

  return rows.map((row) =>
    eventSchema.parse({
      id: row.id,
      origin: row.origin,
      category: row.category,
      title: row.title,
      severity: row.severity,
      color: row.color,
      from: row.starts_at,
      to: row.ends_at,
      position: row.lon === null || row.lat === null ? null : { lon: row.lon, lat: row.lat },
      sourceId: row.source_id === null ? null : Number(row.source_id),
      media: row.media,
      crossing: row.crossing,
    }),
  )
}
