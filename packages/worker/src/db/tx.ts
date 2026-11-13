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
 * A connection taken from the pool, which losing does not end the process.
 *
 * The pool listens to a connection's errors only while it holds it: lent, a
 * connection the server drops emits an `error` nobody hears, which Node raises
 * as uncaught. The query in flight rejects with that same loss, and that is
 * where it is handled; the listener only keeps it from being raised twice.
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
