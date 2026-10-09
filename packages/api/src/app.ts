import express, { type Express } from 'express'

import { DEFAULT_IMAGE_LIMIT } from '@smmarchives/shared'

import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'

import { BuildRegistry, spawnBuild, type BuildLauncher } from './builds.ts'
import { registerCreation } from './creations.ts'
import { registerDatasets } from './datasets.ts'
import { registerEvents } from './events.ts'
import { registerJournal } from './journal.ts'
import { registerMedia } from './media.ts'
import { registerProgress } from './progress.ts'
import { errorHandler, onUnknownRoute } from './problems.ts'
import { registerReplays } from './replays.ts'

export type ApiOptions = {
  catalog: ReplayCatalog
  /**
   * Where what cannot be said in a response is said instead. Silent by
   * default, the way the worker's own sinks are: only `main.ts` wires stderr.
   */
  log?: ((message: string) => void) | undefined
  /** Replaced in tests, which never start a real collection. */
  launch?: BuildLauncher | undefined
  /** How long a creation waits to hear that the build could not start at all. */
  publishTimeout?: number | undefined
  /** How often a followed build is re-read. Shortened in tests. */
  pollIntervalMs?: number | undefined
  /** The heaviest image an agent may attach to an event, in bytes. */
  imageLimit?: number | undefined
}

/** Built without listening, so a test mounts it with neither port nor environment. */
export function createApp(options: ApiOptions): Express {
  const app = express()
  const log = options.log ?? (() => {})

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  const builds = new BuildRegistry(options.launch ?? spawnBuild)
  registerCreation(app, {
    catalog: options.catalog,
    builds,
    publishTimeout: options.publishTimeout ?? 5_000,
    log,
  })
  // Before the replays, whose `/replays/:id` would take `limits` for a name.
  registerEvents(app, {
    catalog: options.catalog,
    imageLimit: options.imageLimit ?? DEFAULT_IMAGE_LIMIT,
    log,
  })
  registerReplays(app, { catalog: options.catalog, builds })
  registerMedia(app, options.catalog)
  registerJournal(app, options.catalog)
  registerProgress(app, options.catalog, options.pollIntervalMs ?? 500)
  // Last: its second segment matches any name, so a literal route of the same
  // shape has to be registered before it.
  registerDatasets(app, options.catalog)

  app.use(onUnknownRoute)
  app.use(errorHandler(log))
  return app
}
