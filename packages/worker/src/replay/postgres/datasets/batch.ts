import type { Queryable } from '../../../db/tx.ts'

/** Rows per statement: a fleet's thresholds or a day of crossings in a handful of round trips. */
const BATCH = 1_000

/**
 * Inserts rows a batch at a time, each batch one statement, which reads the
 * replay from `$1` and its rows from `$2`, a JSON array, through
 * `jsonb_to_recordset`: the rows carry geometries, arrays and documents. A JSON
 * `null` is read as a SQL `NULL`.
 */
export async function insertRows(
  db: Queryable,
  statement: string,
  replayId: string,
  rows: readonly object[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH) {
    await db.query(statement, [replayId, JSON.stringify(rows.slice(start, start + BATCH))])
  }
}
