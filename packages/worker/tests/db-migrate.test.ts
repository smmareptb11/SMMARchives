import { afterAll, describe, expect, it } from 'vitest'

import { migrate } from '../src/db/migrate.ts'
import { MIGRATIONS, closeDatabase, freshDatabase } from './support/database.ts'

const SCHEMA = 'test_migrate'

afterAll(closeDatabase)

describe('applying the migrations', () => {
  it('applies what is missing, and answers what it applied', async () => {
    const pool = await freshDatabase(SCHEMA, { recreate: true })

    expect(await migrate(pool, MIGRATIONS)).toEqual([
      '0001-replay.sql',
      '0002-webcam-thumbnail.sql',
      '0003-manual-event.sql',
    ])
  })

  it('applies nothing the second time', async () => {
    const pool = await freshDatabase(SCHEMA, { recreate: true })
    await migrate(pool, MIGRATIONS)

    expect(await migrate(pool, MIGRATIONS)).toEqual([])
  })

  it('leaves the schema a replay needs', async () => {
    const pool = await freshDatabase(SCHEMA, { recreate: true })
    await migrate(pool, MIGRATIONS)

    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = $1 and table_name in ('replay', 'measure', 'radar_frame')`,
      [SCHEMA],
    )
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      'measure',
      'radar_frame',
      'replay',
    ])
  })
})
