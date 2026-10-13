import { eventSchema, type ReplayEvent } from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'
import type { ManualEvent } from '../../store.ts'

export async function writeEvents(db: Queryable, replayId: string, data: unknown): Promise<void> {
  const events = data as ReplayEvent[]
  await db.query('delete from event where replay_id = $1', [replayId])

  for (const event of events) {
    await db.query(
      `insert into event (replay_id, id, origin, category, title, description, producer_kind,
                          severity, color, starts_at, ends_at, position, source_id, media,
                          crossing)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               ST_SetSRID(ST_GeomFromGeoJSON($12), 4326), $13, $14::text[], $15::jsonb)`,
      [
        replayId,
        event.id,
        event.origin,
        event.category,
        event.title,
        event.description,
        event.producerKind,
        event.severity,
        event.color,
        event.from,
        event.to,
        event.position === null ? null : JSON.stringify(event.position),
        event.sourceId === null ? null : String(event.sourceId),
        event.media,
        JSON.stringify(event.crossing),
      ],
    )
  }
}

export function readEvents(db: Queryable, replayId: string): Promise<ReplayEvent[]> {
  return selectEvents(db, replayId, null)
}

/** One event, read the way the data set reads them all. */
export async function readEvent(
  db: Queryable,
  replayId: string,
  eventId: string,
): Promise<ReplayEvent | undefined> {
  return (await selectEvents(db, replayId, eventId))[0]
}

async function selectEvents(
  db: Queryable,
  replayId: string,
  eventId: string | null,
): Promise<ReplayEvent[]> {
  const rows = (
    await db.query<{
      id: string
      origin: string
      category: string
      title: string
      description: string | null
      producer_kind: string | null
      severity: number | null
      color: string | null
      starts_at: string
      ends_at: string | null
      position: string | null
      source_id: string | null
      media: string[]
      crossing: unknown
    }>(
      `select id, origin, category, title, description, producer_kind, severity, color,
              starts_at, ends_at, ST_AsGeoJSON(position) as position, source_id, media, crossing
         from event where replay_id = $1 and ($2::text is null or id = $2)
        order by starts_at, id`,
      [replayId, eventId],
    )
  ).rows

  return rows.map((row) =>
    eventSchema.parse({
      id: row.id,
      origin: row.origin,
      category: row.category,
      title: row.title,
      description: row.description,
      producerKind: row.producer_kind,
      severity: row.severity,
      color: row.color,
      from: row.starts_at,
      to: row.ends_at,
      position: row.position === null ? null : (JSON.parse(row.position) as unknown),
      sourceId: row.source_id === null ? null : Number(row.source_id),
      media: row.media,
      crossing: row.crossing,
    }),
  )
}

/** Inserts an agent's event and answers the identifier the database minted. */
export async function insertManualEvent(
  db: Queryable,
  replayId: string,
  event: ManualEvent,
): Promise<string> {
  const inserted = await db.query<{ id: string }>(
    `insert into event (replay_id, origin, category, title, description, producer_kind,
                        starts_at, ends_at, position, media)
     values ($1, 'manual', 'field-report', $2, $3, $4, $5, $6,
             ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), $8::text[])
     returning id`,
    [
      replayId,
      event.title,
      event.description,
      event.producerKind,
      event.from,
      event.to,
      event.position === null ? null : JSON.stringify(event.position),
      event.media,
    ],
  )
  return inserted.rows[0]!.id
}
