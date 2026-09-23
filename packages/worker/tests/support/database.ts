import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import { migrate } from '../../src/db/migrate.ts'
import { openPool } from '../../src/db/pool.ts'

export const MIGRATIONS = fileURLToPath(new URL('../../../../migrations', import.meta.url))

/**
 * The test database.
 *
 * Storage is tested against a real PostgreSQL rather than a double: a port this
 * wide, doubled, would drift, and the failure mode would be a route passing
 * against the double and failing against the database.
 *
 * It throws rather than answering undefined, so a suite that reaches for the
 * database where none is configured stops here, by name, instead of skipping
 * itself and letting the run answer green.
 *
 * It does not police the split. Both projects share one `process.env`, so under
 * `npm test` this answers a forgotten suite as readily as a listed one.
 * `database-guard.test.ts` is what checks the list, and it needs no environment
 * to do it.
 */
export function withDatabase(): string {
  const url = process.env.DATABASE_URL_TEST
  if (url === undefined || url === '') throw new Error(OUTSIDE_THE_DATABASE_SUITE)
  return url
}

const OUTSIDE_THE_DATABASE_SUITE = [
  'test-db — this suite asked for the test database, and none is configured.',
  '',
  'The run carries no `DATABASE_URL_TEST`: either no database was started, or',
  'this suite is running under `npm run test:unit`, which is the narrow suite',
  'and opens none.',
  '',
  'Expected: a suite that stores something is listed, and runs with a database.',
  '',
  'Fix: run `npm test` with the database up. If this suite stores nothing, it',
  '     should not be importing a module that opens a pool; if it does store,',
  '     `database-guard.test.ts` will say so and name the list to add it to.',
  '',
  'Do not answer this by skipping the suite. A suite that skips itself makes the',
  'run green without making it true, which is the failure this replaced.',
  '',
  'Read: AGENTS.md, section Commands.',
].join('\n')

const pools = new Map<string, Pool>()
let bootstrap: Pool | undefined

/**
 * A migrated schema holding nothing, private to one test file.
 *
 * One schema each because Vitest runs test files in parallel: sharing one would
 * have a file empty the tables another is in the middle of reading, and the
 * failure would land in whichever file lost the race. The pool is pinned to its
 * schema through the connection options — `set search_path` would bind the one
 * connection that ran it, not the pool.
 *
 * `public` stays on the path behind it: that is where PostGIS installs its
 * types and its functions.
 */
export async function freshDatabase(
  schema: string,
  options: { recreate?: boolean } = {},
): Promise<Pool> {
  const url = withDatabase()
  bootstrap ??= openPool(url)

  // `recreate` hands back an empty schema with nothing applied, which is what a
  // test of the migrations themselves needs.
  if (options.recreate === true) {
    await pools.get(schema)?.end()
    pools.delete(schema)
    await bootstrap.query(`drop schema if exists ${schema} cascade`)
    await bootstrap.query(`create schema ${schema}`)
    return pinnedTo(schema, url)
  }
  await bootstrap.query(`create schema if not exists ${schema}`)

  const existing = pools.get(schema)
  if (existing !== undefined) {
    // Emptied by truncating `replay`: everything else hangs off it by a
    // cascading reference, so one statement covers the schema and a table added
    // later is emptied without this file learning its name.
    await existing.query('truncate table replay cascade')
    return existing
  }

  const pool = pinnedTo(schema, url)
  await migrate(pool, MIGRATIONS)
  await pool.query('truncate table replay cascade')
  return pool
}

function pinnedTo(schema: string, url: string): Pool {
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` })
  pools.set(schema, pool)
  return pool
}

/** Closes every pool a suite opened, for an `afterAll`. */
export async function closeDatabase(): Promise<void> {
  for (const pool of pools.values()) await pool.end()
  pools.clear()
  await bootstrap?.end()
  bootstrap = undefined
}
