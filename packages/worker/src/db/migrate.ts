import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Pool, PoolClient } from 'pg'

import { rolledBack } from './tx.ts'

/**
 * Applies the migrations the database has not seen yet, in name order.
 *
 * Each runs in its own transaction, so a migration that fails leaves the
 * database on the last one that worked rather than half way through this one.
 * PostgreSQL runs DDL transactionally, which is what makes that promise real.
 *
 * Under a lock held for the whole run: two runs started together — two
 * containers coming up — would otherwise both read the same migration as
 * pending and both apply it. The lock is the schema's own, so two schemas of
 * one database migrate side by side.
 */
export async function migrate(pool: Pool, directory: string): Promise<string[]> {
  const client = await pool.connect()
  let failed = false
  try {
    await client.query(`select pg_advisory_lock(hashtext('migrate ' || current_schema()))`)
    return await applyPending(client, directory)
  } catch (error) {
    failed = true
    throw error
  } finally {
    // A run that failed destroys its client rather than unlocking through it:
    // closing the session releases the lock whatever state the connection is
    // in, and nothing can raise in place of the error that stopped the run.
    if (!failed) {
      await client.query(`select pg_advisory_unlock(hashtext('migrate ' || current_schema()))`)
    }
    client.release(failed)
  }
}

async function applyPending(client: PoolClient, directory: string): Promise<string[]> {
  await client.query(
    `create table if not exists schema_migration (
       name text primary key,
       applied_at timestamptz not null default now())`,
  )
  const done = new Set(
    (await client.query<{ name: string }>('select name from schema_migration')).rows.map(
      (row) => row.name,
    ),
  )
  const pending = (await readdir(directory))
    .filter((name) => name.endsWith('.sql') && !done.has(name))
    .sort()

  const applied: string[] = []
  for (const name of pending) {
    await apply(client, join(directory, name), name)
    applied.push(name)
  }
  return applied
}

async function apply(client: PoolClient, path: string, name: string): Promise<void> {
  const sql = await readFile(path, 'utf8')
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('insert into schema_migration (name) values ($1)', [name])
    await client.query('commit')
  } catch (error) {
    await rolledBack(client)
    throw error
  }
}
