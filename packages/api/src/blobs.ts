import { pipeline } from 'node:stream/promises'

import type { Request, Response } from 'express'

import type { StoredBlob } from '@smmarchives/worker/replay/store.ts'

export type BlobOptions = {
  /** A media type, or an extension Express resolves into one. */
  contentType: string
  cacheControl: string
}

const UNNAMED = 'application/octet-stream'

/**
 * Sends stored bytes without decoding them.
 *
 * Its own module rather than the data sets': media are served the same way,
 * with another content type and another cache policy, and nothing here knows
 * about either.
 */
export async function sendBlob(
  req: Request,
  res: Response,
  blob: StoredBlob,
  options: BlobOptions,
): Promise<void> {
  res.setHeader('ETag', `"${blob.version}"`)
  res.setHeader('Cache-Control', options.cacheControl)
  res.type(options.contentType)

  // Everything this API answers is bytes a source outside it produced, under a
  // type nobody here chose. Without this a browser sniffs, and it sniffs
  // hardest at what could not be named — which is then handed over rather than
  // rendered.
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (res.getHeader('Content-Type') === UNNAMED) {
    res.setHeader('Content-Disposition', 'attachment')
  }

  // Express reads the ETag just set. Hand-rolling the comparison would miss
  // `*`, a list of tags, and the weak prefix an intermediary may add — and it
  // would ignore a client asking not to be answered from a cache.
  if (req.fresh) return without(res.status(304), blob)

  res.setHeader('Content-Length', String(blob.size))
  // Express answers HEAD through the GET handler, and reading a 19 MB body to
  // throw it away is the whole cost of the request.
  if (req.method === 'HEAD') return without(res, blob)

  try {
    await pipeline(blob.body, res)
  } catch (error) {
    // A client that closes its tab aborts the pipeline. Nothing failed, and a
    // log line per abandoned download would bury the ones that matter.
    if ((error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error
  }
}

/** A body nobody reads is a file handle nobody closes. */
function without(res: Response, blob: StoredBlob): void {
  blob.body.destroy()
  res.end()
}
