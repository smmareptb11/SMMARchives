import { Pool, types } from 'pg'

const TIMESTAMPTZ = 1184
const INT8 = 20

/**
 * An instant comes back as ISO 8601 UTC, never as a `Date`.
 *
 * `pg` parses a `timestamptz` into a `Date` built in the process's own zone, and
 * every instant in this project is normalised onto one clock. A conversion on
 * the way out is exactly the silent desynchronisation that rule exists to
 * prevent — and it would show nowhere, a replay reading plausibly with its whole
 * chronology shifted.
 */
types.setTypeParser(TIMESTAMPTZ, (value) => new Date(value).toISOString())

/**
 * `count(*)` is a `bigint`, which `pg` hands over as a string so no count above
 * 2^53 is quietly rounded. Ours are counts of measures in one replay; a string
 * where the manifest promises a number would be the real defect here.
 */
types.setTypeParser(INT8, (value) => Number(value))

export function openPool(url: string): Pool {
  return new Pool({ connectionString: url })
}
