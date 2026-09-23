import type { Pool, QueryResult, QueryResultRow } from 'pg'

/**
 * What a query can be sent to: the pool, or one client inside a transaction.
 *
 * Written as the one signature this project uses, so a function says whether it
 * needs a transaction by asking for a client rather than by convention.
 */
export type Queryable = {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>
}

/**
 * A unit of work that lands whole or not at all.
 *
 * What a lane needs when it rewrites a data set: it clears its own rows and
 * inserts the new ones, and a run that dies between the two must leave the
 * previous run's rows rather than nothing.
 */
export async function tx<T>(pool: Pool, work: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
