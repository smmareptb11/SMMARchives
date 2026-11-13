import compression from 'compression'
import type { Express, Request, Response } from 'express'

import { datasetNameSchema, parseInstant, windowOf, type DatasetName } from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import { MAPPINGS, type DatasetFilter } from '@smmarchives/worker/replay/postgres/datasets/index.ts'

import { sendBlob } from './blobs.ts'
import { badRequest, notFound } from './problems.ts'
import { cachedFor, openReplay } from './replays.ts'

/** Not immutable: a build fills a data set while it is read, and an agent changes the events. */
const REVALIDATE = 'public, max-age=0, must-revalidate'

export function registerDatasets(app: Express, catalog: ReplayCatalog): void {
  app.get(
    '/replays/:id/:dataset',
    // Here rather than on the application: a data set is the only payload
    // worth compressing, and compression would hold an event stream back.
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

      // Only the manifest tells a data set nobody collected from one collected
      // empty: both hold no rows.
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
        cacheControl: cachedFor(opened.manifest, REVALIDATE),
      })
    },
  )
}

/**
 * What the query narrows the data set by, or why it could not. A filter the data
 * set does not take is refused rather than dropped: a client that misspelled
 * `source` would otherwise read the whole set as if it had asked for it.
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
 * Each bound on the single clock, alone or not, and the two in order: `from`
 * after `to` is a refusal rather than an empty answer a client would read as an
 * absence. What reaches the database is the normalised instant, never the
 * client's text, which it would read in the zone of its session.
 */
function checkedWindow(filter: DatasetFilter): DatasetFilter | string {
  try {
    if (filter.from !== undefined && filter.to !== undefined) {
      return { ...filter, ...windowOf(filter.from, filter.to) }
    }
    return {
      ...filter,
      ...(filter.from === undefined ? {} : { from: parseInstant(filter.from) }),
      ...(filter.to === undefined ? {} : { to: parseInstant(filter.to) }),
    }
  } catch {
    return 'from and to must be instants naming their zone, in order'
  }
}
