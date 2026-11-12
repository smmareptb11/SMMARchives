import { eventSchema, type ReplayEvent } from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'
import type { ManualEvent } from '../../store.ts'
import { insertRows } from './batch.ts'

export async function writeEvents(db: Queryable, replayId: string, data: unknown): Promise<void> {
  const events = data as ReplayEvent[]
  await insertRows(
    db,
    `insert into event (replay_id, id, origin, category, title, description, producer_kind,
                        link, severity, color, starts_at, ends_at, position, source_id, media,
                        crossing)
     select $1, r.id, r.origin, r.category, r.title, r.description, r.producer_kind,
            r.link, r.severity, r.color, r.starts_at, r.ends_at,
            ST_SetSRID(ST_GeomFromGeoJSON(r.position::text), 4326), r.source_id, r.media,
            r.crossing
       from jsonb_to_recordset($2::jsonb) as r(id text, origin text, category text,
            title text, description text, producer_kind text, link text, severity integer,
            color text, starts_at timestamptz, ends_at timestamptz, position jsonb,
            source_id text, media text[], crossing jsonb)`,
    replayId,
    events.map((event) => ({
      id: event.id,
      origin: event.origin,
      category: event.category,
      title: event.title,
      description: event.description,
      producer_kind: event.producerKind,
      link: event.link,
      severity: event.severity,
      color: event.color,
      starts_at: event.from,
      ends_at: event.to,
      position: event.position,
      source_id: event.sourceId === null ? null : String(event.sourceId),
      media: event.media,
      // An event that crossed nothing holds no crossing: a SQL null, which
      // `crossing is null` finds, and not the JSON value `null`.
      crossing: event.crossing,
    })),
  )
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
      link: string | null
      severity: number | null
      color: string | null
      starts_at: string
      ends_at: string | null
      position: string | null
      source_id: string | null
      media: string[]
      crossing: unknown
    }>(
      `select id, origin, category, title, description, producer_kind, link, severity, color,
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
      link: row.link,
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
                        link, starts_at, ends_at, position, media)
     values ($1, 'manual', 'field-report', $2, $3, $4, $5, $6, $7,
             ST_SetSRID(ST_GeomFromGeoJSON($8), 4326), $9::text[])
     returning id`,
    [
      replayId,
      event.title,
      event.description,
      event.producerKind,
      event.link,
      event.from,
      event.to,
      event.position === null ? null : JSON.stringify(event.position),
      event.media,
    ],
  )
  return inserted.rows[0]!.id
}

/** Rewrites what an agent wrote of an event, leaving what the store settled. */
export async function updateManualEvent(
  db: Queryable,
  replayId: string,
  eventId: string,
  event: ManualEvent,
): Promise<void> {
  await db.query(
    `update event
        set title = $3, description = $4, producer_kind = $5, link = $6, starts_at = $7,
            ends_at = $8, position = ST_SetSRID(ST_GeomFromGeoJSON($9), 4326),
            media = $10::text[]
      where replay_id = $1 and id = $2 and origin = 'manual'`,
    [
      replayId,
      eventId,
      event.title,
      event.description,
      event.producerKind,
      event.link,
      event.from,
      event.to,
      event.position === null ? null : JSON.stringify(event.position),
      event.media,
    ],
  )
}

export async function deleteManualEvent(
  db: Queryable,
  replayId: string,
  eventId: string,
): Promise<void> {
  await db.query(`delete from event where replay_id = $1 and id = $2 and origin = 'manual'`, [
    replayId,
    eventId,
  ])
}
