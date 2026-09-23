import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Pool } from 'pg'

/**
 * Applies the migrations the database has not seen yet, in name order.
 *
 * Each runs in its own transaction, so a migration that fails leaves the
 * database on the last one that worked rather than half way through this one.
 * PostgreSQL runs DDL transactionally, which is what makes that promise real.
 */
export async function migrate(pool: Pool, directory: string): Promise<string[]> {
  await pool.query(
    `create table if not exists schema_migration (
       name text primary key,
       applied_at timestamptz not null default now())`,
  )
  const done = new Set(
    (await pool.query<{ name: string }>('select name from schema_migration')).rows.map(
      (row) => row.name,
    ),
  )
  const pending = (await readdir(directory))
    .filter((name) => name.endsWith('.sql') && !done.has(name))
    .sort()

  const applied: string[] = []
  for (const name of pending) {
    await apply(pool, join(directory, name), name)
    applied.push(name)
  }
  return applied
}

async function apply(pool: Pool, path: string, name: string): Promise<void> {
  const sql = await readFile(path, 'utf8')
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('insert into schema_migration (name) values ($1)', [name])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
