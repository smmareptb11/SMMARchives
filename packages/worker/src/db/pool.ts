import { Pool, types } from 'pg'

const TIMESTAMPTZ = 1184
const INT8 = 20

/**
 * An instant comes back as ISO 8601 UTC, never as a `Date` built in the
 * process's own zone, which would shift a whole chronology without a sign.
 */
types.setTypeParser(TIMESTAMPTZ, (value) => new Date(value).toISOString())

/**
 * `count(*)` is a `bigint`, which `pg` hands over as a string. Ours count rows of
 * one replay, far below 2^53, and the manifest promises numbers.
 */
types.setTypeParser(INT8, (value) => Number(value))

export function openPool(url: string): Pool {
  return new Pool({ connectionString: url })
}
