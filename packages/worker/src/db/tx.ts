import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

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
 * What a lane needs when it stores a data set: a run that dies halfway through
 * the insert must leave nothing rather than half of it.
 */
export async function tx<T>(pool: Pool, work: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('begin')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    broken = !(await rolledBack(client))
    throw error
  } finally {
    client.release(broken)
  }
}

/**
 * Rolls back, and answers whether it could.
 *
 * A rollback fails on a connection already lost, and its error would then take
 * the place of the one that made it necessary: the reason the work failed is
 * the one worth reading. A client that could not roll back is destroyed
 * rather than handed back to the pool mid-transaction.
 */
export async function rolledBack(client: PoolClient): Promise<boolean> {
  try {
    await client.query('rollback')
    return true
  } catch {
    return false
  }
}
