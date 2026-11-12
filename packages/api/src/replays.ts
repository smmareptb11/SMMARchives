import type { Express, Response } from 'express'

import { replayIdSchema, type ReplayManifest } from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import type { ReplayStore } from '@smmarchives/worker/replay/store.ts'

import type { BuildRegistry } from './builds.ts'
import { badRequest, conflict, notFound } from './problems.ts'
import { isAdmin } from './session.ts'

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
  if (!isVisible(res, manifest)) {
    notFound(res, `no replay ${id}`)
    return undefined
  }
  return { store, manifest }
}

/**
 * Whether the request may see the replay at all. A stranger is answered as if
 * an unpublished replay did not exist, in the words used for one that does not.
 */
export function isVisible(res: Response, manifest: ReplayManifest | undefined): boolean {
  return isAdmin(res) || manifest?.publishedAt !== undefined
}

/**
 * `private` while the replay is not published, so no shared cache keeps what
 * only the administrator was shown.
 */
export function cachedFor(manifest: ReplayManifest, policy: string): string {
  return manifest.publishedAt === undefined ? policy.replace(/^public\b/, 'private') : policy
}

/** The listing and a manifest change with the session that asks for them. */
const PER_SESSION = 'private, no-cache'

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
    const manifests = await catalog.list()
    res.set('Cache-Control', PER_SESSION)
    res.json(manifests.filter((manifest) => isVisible(res, manifest)))
  })

  app.get('/replays/:id', async (req, res) => {
    const opened = await openReplay(catalog, res, req.params.id)
    if (opened === undefined) return

    res.set('Cache-Control', PER_SESSION)
    res.json(opened.manifest)
  })

  app.put('/replays/:id/publication', async (req, res) => {
    const opened = await openReplay(catalog, res, req.params.id)
    if (opened === undefined) return

    if (!(await opened.store.publish())) {
      const { id, state } = opened.manifest
      conflict(res, `replay ${id} is ${state}, and only a complete replay is published`)
      return
    }
    res.json(await opened.store.getManifest())
  })

  app.delete('/replays/:id/publication', async (req, res) => {
    const opened = await openReplay(catalog, res, req.params.id)
    if (opened === undefined) return

    await opened.store.unpublish()
    res.json(await opened.store.getManifest())
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
