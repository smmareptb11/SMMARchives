import { afterAll, describe, expect, it } from 'vitest'

import { tx } from '../src/db/tx.ts'
import { closeDatabase, freshDatabase } from './support/database.ts'

const SCHEMA = 'test_tx'

afterAll(closeDatabase)

describe('a transaction whose connection is lost', () => {
  it('fails with the error of the work, not with the rollback that could not follow', async () => {
    const pool = await freshDatabase(SCHEMA, { recreate: true })

    await expect(
      tx(pool, async (db) => {
        await db.query('select pg_terminate_backend(pg_backend_pid())').catch(() => {})
        throw new Error('the work failed')
      }),
    ).rejects.toThrow('the work failed')
    // The lost client was not handed back: the pool still answers.
    expect((await pool.query('select 1 as one')).rows).toEqual([{ one: 1 }])
  })
})
