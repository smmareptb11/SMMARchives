import { journalEntrySchema, type JournalEntry } from '@smmarchives/shared'

import type { Queryable } from '../../db/tx.ts'

/**
 * Appends one entry, numbering it after the last of *this* replay.
 *
 * The number is what `?since=` and `Last-Event-ID` resume on, so it has to be
 * dense and per replay rather than a sequence shared by every build. Only one
 * process writes a replay's journal, which is what makes reading the maximum
 * inside the insert enough.
 */
export async function appendJournal(
  db: Queryable,
  replayId: string,
  entry: JournalEntry,
): Promise<void> {
  await db.query(
    `insert into replay_journal (replay_id, line, at, lane, kind, message)
     select $1, coalesce(max(line) + 1, 0), $2, $3, $4, $5
       from replay_journal where replay_id = $1`,
    [replayId, entry.at, entry.lane, entry.kind, entry.message ?? null],
  )
}

/** The entries from the given line on, in the order they were written. */
export async function readJournal(
  db: Queryable,
  replayId: string,
  from: number,
): Promise<JournalEntry[]> {
  const rows = (
    await db.query<{ at: string; lane: string; kind: string; message: string | null }>(
      `select at, lane, kind, message from replay_journal
        where replay_id = $1 and line >= $2 order by line`,
      [replayId, Math.max(from, 0)],
    )
  ).rows

  return rows.map((row) =>
    journalEntrySchema.parse({
      at: row.at,
      lane: row.lane,
      kind: row.kind,
      ...(row.message === null ? {} : { message: row.message }),
    }),
  )
}
