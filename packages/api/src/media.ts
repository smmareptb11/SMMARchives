import { extname } from 'node:path'

import type { Express, Request, Response } from 'express'

import { FROZEN_MEDIA_EXTENSIONS } from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import { isMediaPath } from '@smmarchives/worker/replay/store.ts'

import { sendBlob } from './blobs.ts'
import { badRequest, notFound } from './problems.ts'
import { openReplay } from './replays.ts'

/**
 * A frozen medium is never rewritten: freezing skips a path the store already
 * holds — `freezeOne`, in the worker's `replay/media.ts` — and the path is
 * derived from the code and the instant. One address, one set of bytes, for
 * good. Make that copy unconditional and this header becomes a lie no client
 * can catch for a year.
 */
const FOREVER = 'public, max-age=31536000, immutable'

export function registerMedia(app: Express, catalog: ReplayCatalog): void {
  app.get(
    '/replays/:id/media/*path',
    async (req: Request<{ id: string; path: string[] }>, res: Response) => {
      // Express decodes each segment, so a `%2f` reaches this string as a real
      // separator. What holds the containment is the port's own rule.
      const path = req.params.path.join('/')
      if (!isMediaPath(path)) {
        // Refused before storage is touched, and the path is the client's own
        // text, which no error body repeats.
        badRequest(res, 'a medium is addressed relative to its replay')
        return
      }

      const opened = await openReplay(catalog, res, req.params.id)
      if (opened === undefined) return

      const blob = await opened.store.openMedia(path)
      if (blob === undefined) {
        notFound(res, `replay ${req.params.id} froze no such medium`)
        return
      }

      const extension = extname(path).slice(1).toLowerCase()
      await sendBlob(req, res, blob, {
        contentType: FROZEN_MEDIA_EXTENSIONS.has(extension)
          ? extension
          : 'application/octet-stream',
        cacheControl: FOREVER,
      })
    },
  )
}
