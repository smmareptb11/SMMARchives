import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

/** What a query can be sent to: the pool, or one client inside a transaction. */
export type Queryable = {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>
}

/** A unit of work that lands whole or not at all. */
export async function tx<T>(pool: Pool, work: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await borrow(pool)
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
    giveBack(client, broken)
  }
}

/**
 * A connection taken from the pool, which losing does not end the process: the
 * pool stops listening to a lent connection's errors, and Node raises one
 * nobody hears as uncaught. The query in flight rejects with the same loss.
 */
export async function borrow(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect()
  client.on('error', heardElsewhere)
  return client
}

/**
 * Hands a connection back, or destroys it when it is broken. A destroyed one
 * keeps its listener: its socket may still report the loss after this.
 */
export function giveBack(client: PoolClient, broken: boolean): void {
  if (!broken) client.off('error', heardElsewhere)
  client.release(broken)
}

function heardElsewhere(): void {}

/**
 * Rolls back, and answers whether it could, rather than letting the rollback's
 * error hide the one that made it necessary.
 */
export async function rolledBack(client: PoolClient): Promise<boolean> {
  try {
    await client.query('rollback')
    return true
  } catch {
    return false
  }
}
