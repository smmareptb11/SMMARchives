import { fileURLToPath } from 'node:url'

import { ExitCode, databaseConfig } from '@smmarchives/shared'

import { progress, runProcess } from '../cli.ts'
import { migrate } from '../db/migrate.ts'
import { openPool } from '../db/pool.ts'

const MIGRATIONS = fileURLToPath(new URL('../../../../migrations', import.meta.url))

await runProcess(async () => {
  const pool = openPool(databaseConfig().url)
  try {
    const applied = await migrate(pool, MIGRATIONS)
    progress(applied.length === 0 ? 'nothing to apply' : `applied ${applied.join(', ')}`)
    return ExitCode.success
  } finally {
    await pool.end()
  }
})
