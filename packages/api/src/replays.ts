import type { Express, Response } from 'express'

import { replayIdSchema, type ReplayManifest } from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import type { ReplayStore } from '@smmarchives/worker/replay/store.ts'

import type { BuildRegistry } from './builds.ts'
import { badRequest, conflict, notFound } from './problems.ts'

/**
 * Resolves an identifier into a replay whose content can be served, or answers
 * why it could not.
 *
 * A syntactically impossible identifier is a 400 — it names nothing, and never
 * reaches storage — and a well-formed one nobody built is a 404. The manifest
 * comes back with the store because reading it is how the question was
 * answered.
 */
export async function openReplay(
  catalog: ReplayCatalog,
  res: Response,
  id: string,
): Promise<{ store: ReplayStore; manifest: ReplayManifest } | undefined> {
  if (!checkedReplayId(res, id)) return undefined

  const store = await catalog.open(id)
  if (store === undefined) {
    notFound(res, `no replay ${id}`)
    return undefined
  }

  const manifest = await store.getManifest()
  if (manifest === undefined) {
    notFound(res, `replay ${id} holds no manifest`)
    return undefined
  }
  return { store, manifest }
}

/**
 * A name that could not address a replay, refused before storage is touched.
 *
 * The message is the contract's own, so a route never restates a rule that
 * lives in `replayIdSchema`.
 */
export function checkedReplayId(res: Response, id: string): boolean {
  const parsed = replayIdSchema.safeParse(id)
  if (parsed.success) return true
  badRequest(res, parsed.error.issues[0]?.message ?? 'is not a replay identifier')
  return false
}

export type ReplayRoutes = {
  catalog: ReplayCatalog
  builds: BuildRegistry
}

export function registerReplays(app: Express, routes: ReplayRoutes): void {
  const { builds, catalog } = routes
  app.get('/replays', async (_req, res) => {
    res.json(await catalog.list())
  })

  app.get('/replays/:id', async (req, res) => {
    const opened = await openReplay(catalog, res, req.params.id)
    if (opened === undefined) return

    res.json(opened.manifest)
  })

  app.delete('/replays/:id', async (req, res) => {
    const { id } = req.params
    if (!checkedReplayId(res, id)) return

    // Not through `openReplay`, which turns away exactly what most needs
    // removing. Claimed rather than asked about, so nothing can start a build
    // on this name while it is going away — and refused on that claim, never
    // on the manifest. What it does not promise: this registry lives in
    // memory, and knows only what this instance started.
    if (!builds.reserve(id)) {
      conflict(res, `replay ${id} is being built`)
      return
    }
    try {
      if (!(await catalog.remove(id))) {
        notFound(res, `no replay ${id}`)
        return
      }
      res.status(204).end()
    } finally {
      builds.release(id)
    }
  })
}
