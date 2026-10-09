import { eventSchema, type ReplayEvent } from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'
import type { ManualEvent } from '../../store.ts'

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
      `insert into event (replay_id, id, origin, category, title, description, provenance,
                          severity, color, starts_at, ends_at, position, source_id, media,
                          crossing)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               case when $12::double precision is null then null
                    else ST_SetSRID(ST_MakePoint($12, $13), 4326) end,
               $14, $15::text[], $16::jsonb)`,
      [
        replayId,
        event.id,
        event.origin,
        event.category,
        event.title,
        event.description,
        event.provenance,
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
  return selectEvents(db, 'replay_id = $1', [replayId])
}

/** One event, without reading every crossing of the replay to find it. */
export async function readEvent(
  db: Queryable,
  replayId: string,
  eventId: string,
): Promise<ReplayEvent | undefined> {
  return (await selectEvents(db, 'replay_id = $1 and id = $2', [replayId, eventId]))[0]
}

async function selectEvents(
  db: Queryable,
  where: string,
  values: unknown[],
): Promise<ReplayEvent[]> {
  const rows = (
    await db.query<{
      id: string
      origin: string
      category: string
      title: string
      description: string | null
      provenance: string | null
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
      `select id, origin, category, title, description, provenance, severity, color,
              starts_at, ends_at,
              ST_X(position) as lon, ST_Y(position) as lat, source_id, media, crossing
         from event where ${where} order by starts_at, id`,
      values,
    )
  ).rows

  return rows.map((row) =>
    eventSchema.parse({
      id: row.id,
      origin: row.origin,
      category: row.category,
      title: row.title,
      description: row.description,
      provenance: row.provenance,
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

/** An agent's event, under an identifier the database mints. */
export async function insertManualEvent(
  db: Queryable,
  replayId: string,
  event: ManualEvent,
): Promise<ReplayEvent> {
  const minted = (
    await db.query<{ id: string }>(
      `insert into event (replay_id, id, origin, category, title, description, provenance,
                          starts_at, ends_at, position)
       values ($1, gen_random_uuid()::text, 'manual', 'report', $2, $3, $4, $5, $6,
               case when $7::double precision is null then null
                    else ST_SetSRID(ST_MakePoint($7, $8), 4326) end)
       returning id`,
      [
        replayId,
        event.title,
        event.description,
        event.provenance,
        event.from,
        event.to,
        event.position?.lon ?? null,
        event.position?.lat ?? null,
      ],
    )
  ).rows[0]?.id
  if (minted === undefined) throw new Error('the database minted no event identifier')

  return eventSchema.parse({
    ...event,
    id: minted,
    origin: 'manual',
    category: 'report',
    severity: null,
    color: null,
    sourceId: null,
    media: [],
    crossing: null,
  })
}

/** Whether the medium went onto an agent's event that held none. */
export async function attachMedia(
  db: Queryable,
  replayId: string,
  eventId: string,
  path: string,
): Promise<boolean> {
  const updated = await db.query(
    `update event set media = array[$3]
      where replay_id = $1 and id = $2 and origin = 'manual' and cardinality(media) = 0`,
    [replayId, eventId, path],
  )
  return updated.rowCount === 1
}
