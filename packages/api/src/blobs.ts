import { pipeline } from 'node:stream/promises'

import type { Request, Response } from 'express'

import type { StoredBlob } from '@smmarchives/worker/replay/store.ts'

type BlobOptions = {
  /** A media type, or an extension Express resolves into one. */
  contentType: string
  cacheControl: string
}

const UNNAMED = 'application/octet-stream'

/** Sends stored bytes without decoding them, whatever their type and cache policy. */
export async function sendBlob(
  req: Request,
  res: Response,
  blob: StoredBlob,
  options: BlobOptions,
): Promise<void> {
  res.setHeader('ETag', `"${blob.version}"`)
  res.setHeader('Cache-Control', options.cacheControl)
  res.type(options.contentType)

  // These bytes come from outside sources, under a type nobody here chose: no
  // sniffing, and what could not be named is downloaded rather than rendered.
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (res.getHeader('Content-Type') === UNNAMED) {
    res.setHeader('Content-Disposition', 'attachment')
  }

  // Express reads the ETag just set, and knows `*`, tag lists, weak prefixes
  // and `no-cache`, which a hand-rolled comparison would miss.
  if (req.fresh) return without(res.status(304), blob)

  res.setHeader('Content-Length', String(blob.size))
  // Express answers HEAD through the GET handler, which must not read a body
  // only to throw it away.
  if (req.method === 'HEAD') return without(res, blob)

  try {
    await pipeline(blob.body, res)
  } catch (error) {
    // A client that closes its tab aborts the pipeline, and nothing failed.
    if ((error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error
  }
}

/** A body nobody reads is a file handle nobody closes. */
function without(res: Response, blob: StoredBlob): void {
  blob.body.destroy()
  res.end()
}
