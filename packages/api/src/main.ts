import { apiConfig, databaseConfig, mediaConfig } from '@smmarchives/shared'
import { openPool } from '@smmarchives/worker/db/pool.ts'
import { openPostgresCatalog } from '@smmarchives/worker/replay/postgres/catalog.ts'

import { createApp } from './app.ts'
import { describe } from './problems.ts'

/** The only place stderr is wired, as it is on the worker's side. */
function log(message: string): void {
  process.stderr.write(`${message}\n`)
}

try {
  const { port } = apiConfig()
  const pool = openPool(databaseConfig().url)
  const catalog = openPostgresCatalog({ pool, mediaRoot: mediaConfig().root, onProgress: log })

  createApp({ catalog, log }).listen(port, () => {
    log(`api listening on ${port}`)
  })
} catch (error) {
  // A misconfiguration names itself and stops, rather than printing a stack an
  // operator has to read through — the bargain the collection scripts make.
  log(error instanceof Error && error.name !== 'Error' ? error.message : describe(error))
  process.exit(1)
}
