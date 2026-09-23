import compression from 'compression'
import type { Express, Request, Response } from 'express'

import { datasetNameSchema, windowOf, type DatasetName } from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import { MAPPINGS, type DatasetFilter } from '@smmarchives/worker/replay/postgres/datasets/index.ts'

import { sendBlob } from './blobs.ts'
import { badRequest, notFound } from './problems.ts'
import { openReplay } from './replays.ts'

/** Not immutable: a re-run rewrites a data set in place. */
const REVALIDATE = 'public, max-age=0, must-revalidate'

export function registerDatasets(app: Express, catalog: ReplayCatalog): void {
  app.get(
    '/replays/:id/:dataset',
    // Here rather than on the application: a data set is the only payload
    // worth compressing — 19 MB of measures — and an event stream is one that
    // compression would hold in a buffer until it overflows.
    compression(),
    // Spelled out because a route with more than one handler no longer infers
    // its parameters, and Express types an uninferred one as possibly an array.
    /* eslint-disable-next-line max-statements -- five refusals and one answer, each guard
       returning where it decides */
    async (req: Request<{ id: string; dataset: string }>, res: Response) => {
      const name = datasetNameSchema.safeParse(req.params.dataset)
      if (!name.success) {
        // Refused before storage is touched, and the name is the client's own
        // text, which no error body repeats.
        notFound(res, 'no data set goes by that name')
        return
      }

      const filter = filterFor(name.data, req.query)
      if (typeof filter === 'string') {
        badRequest(res, filter)
        return
      }

      const opened = await openReplay(catalog, res, req.params.id)
      if (opened === undefined) return

      // The manifest answers whether a lane produced it, which nothing else
      // can: a data set nobody collected and one collected empty hold the same
      // number of rows, and only the manifest tells them apart.
      if (opened.manifest.datasets[name.data] === undefined) {
        notFound(res, `replay ${req.params.id} holds no ${name.data}`)
        return
      }

      const blob = await opened.store.openDataset(name.data, filter)
      if (blob === undefined) {
        notFound(res, `replay ${req.params.id} holds no ${name.data}`)
        return
      }
      await sendBlob(req, res, blob, {
        contentType: 'application/json',
        cacheControl: REVALIDATE,
      })
    },
  )
}

/**
 * What the query narrows the data set by, or why it could not.
 *
 * A filter a data set does not answer to is refused rather than dropped: served
 * the whole set instead, a client that misspelled `source` would read a station
 * it never asked for as if it had.
 */
function filterFor(name: DatasetName, query: Request['query']): DatasetFilter | string {
  const narrows = MAPPINGS[name].narrows
  const filter: DatasetFilter = {}

  for (const [key, value] of Object.entries(query)) {
    if (!narrows.includes(key as keyof DatasetFilter)) {
      return narrows.length === 0
        ? `${name} takes no filter`
        : `${name} is narrowed by ${narrows.join(', ')}, and nothing else`
    }
    if (typeof value !== 'string') return `${key} is given more than once`
    filter[key as keyof DatasetFilter] = value
  }

  return checkedWindow(filter)
}

/**
 * A window is ordered where every other one is, so `from` after `to` is a
 * refusal rather than an empty answer a client would read as an absence.
 */
function checkedWindow(filter: DatasetFilter): DatasetFilter | string {
  if (filter.from === undefined || filter.to === undefined) return filter
  try {
    windowOf(filter.from, filter.to)
    return filter
  } catch {
    return 'from and to must be two instants, in order'
  }
}
