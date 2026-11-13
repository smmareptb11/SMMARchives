import { randomUUID } from 'node:crypto'

import express, { type Express, type Response } from 'express'
import type { z } from 'zod'

import type { ReplayEvent, ReplayManifest } from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import type { ManualEventChange, ReplayStore } from '@smmarchives/worker/replay/store.ts'

import type { BuildRegistry } from './builds.ts'
import {
  badRequest,
  conflict,
  contentTooLarge,
  describe,
  notFound,
  refusalsIn,
  unsupportedMediaType,
} from './problems.ts'
import { checkedReplayId, openReplay } from './replays.ts'
import { amendmentSchemaFor, reportSchemaFor } from './reports.ts'
import { readReport, type Refusal, type ReportReader } from './uploads.ts'

export type EventRoutes = {
  catalog: ReplayCatalog
  builds: BuildRegistry
  /** Where a photo that could not be removed is told of, since the response says the change is done. */
  log: (message: string) => void
}

type Opened = { store: ReplayStore; manifest: ReplayManifest }

const JSON_BODY = express.json({ limit: '64kb' })

/** An amendment that kept a photo the event no longer holds. */
const CHANGED = Symbol('changed')

export function registerEvents(app: Express, routes: EventRoutes): void {
  app.post('/replays/:id/events', JSON_BODY, async (req, res) => {
    await withReportable(routes, res, req.params.id, async (found, written) => {
      const { manifest, store } = found
      const read = await readReport(req, readerFor(reportSchemaFor(manifest), store))
      if ('status' in read) return refuse(res, read)

      const added = await written(
        () => store.addManualEvent({ ...read.report, media: read.media }),
        read.media,
      )
      if (added !== undefined) res.status(201).json(added.done)
    })
  })

  app.put('/replays/:id/events/:eventId', JSON_BODY, async (req, res) => {
    await withReportable(routes, res, req.params.id, async (found, written) => {
      const { manifest, store } = found
      const previous = await store.getManualEvent(req.params.eventId)
      if (previous === undefined) return noSuchEvent(res, manifest)

      const schema = amendmentSchemaFor(manifest, previous.media)
      const read = await readReport(req, readerFor(schema, store))
      if ('status' in read) return refuse(res, read)

      // The photos kept, in the order the agent left them, then the new ones.
      const { media: kept, ...report } = read.report
      const amended = await written(async () => {
        // Judged again: another amendment, written while these photos arrived,
        // may have removed a kept one with its file.
        if (!holdsAll(await store.getManualEvent(previous.id), kept)) return CHANGED
        return store.updateManualEvent(previous.id, { ...report, media: [...kept, ...read.media] })
      }, read.media)
      if (amended === undefined) return
      if (amended.done === CHANGED || amended.done === undefined) {
        // Not written: the photos it sent belong to no event.
        await removePhotos(routes, found, read.media)
        return amended.done === CHANGED
          ? conflict(res, 'the event changed while this amendment was sent; read it again')
          : noSuchEvent(res, manifest)
      }

      await removePhotos(routes, found, dropped(amended.done))
      res.json(amended.done.current)
    })
  })

  app.delete('/replays/:id/events/:eventId', async (req, res) => {
    await withReportable(routes, res, req.params.id, async (found, written) => {
      const { manifest, store } = found
      const removed = await written(() => store.removeManualEvent(req.params.eventId), [])
      if (removed === undefined) return
      if (removed.done === undefined) return noSuchEvent(res, manifest)

      await removePhotos(routes, found, removed.done.media)
      res.status(204).end()
    })
  })
}

/**
 * Runs the write itself with the replay held, or answers why it cannot.
 * Undefined means the answer has been sent, and the photos the change sent are
 * off the volume: they belong to no event.
 */
type Written = <T>(
  write: () => Promise<T>,
  photos: readonly string[],
) => Promise<{ done: T } | undefined>

/**
 * Runs a change on a replay that can take one, or answers why it cannot. The
 * replay is held while the change is written, so it cannot be deleted or built
 * underneath it, but not while photos arrive, which would turn away a second
 * agent reporting meanwhile.
 */
async function withReportable(
  routes: EventRoutes,
  res: Response,
  id: string,
  change: (opened: Opened, written: Written) => Promise<void>,
): Promise<void> {
  if (!checkedReplayId(res, id)) return
  const found = await openReplay(routes.catalog, res, id)
  if (found === undefined || !acceptsReports(res, found.manifest)) return

  await change(found, async (write, photos) => {
    const refusal = await heldOrRefused(routes, id)
    if (refusal !== undefined) {
      // Before the answer, so a client that reads it finds nothing left behind.
      await removePhotos(routes, found, photos)
      refusal(res)
      return undefined
    }
    try {
      return { done: await write() }
    } finally {
      routes.builds.release(id)
    }
  })
}

/**
 * Holds the replay, or answers how to refuse the change without sending it yet.
 * Held, the replay is checked again: a build or a deletion may have begun since
 * it was first opened.
 */
async function heldOrRefused(
  routes: EventRoutes,
  id: string,
): Promise<((res: Response) => void) | undefined> {
  if (!routes.builds.reserve(id)) {
    return (res) => conflict(res, `replay ${id} is being built or deleted`)
  }
  try {
    const manifest = await (await routes.catalog.open(id))?.getManifest()
    const why = manifest === undefined ? `no replay ${id}` : whyNotReportable(manifest)
    if (why === undefined) return undefined
    routes.builds.release(id)
    return (res) => (manifest === undefined ? notFound(res, why) : conflict(res, why))
  } catch (error) {
    routes.builds.release(id)
    throw error
  }
}

/** Never the identifier asked for: it is the client's own text, and no schema cleared it. */
function noSuchEvent(res: Response, manifest: ReplayManifest): void {
  notFound(res, `replay ${manifest.id} holds no such event reported by an agent`)
}

/**
 * Judges the event against its replay, and keeps its photos in a random folder
 * of their own per sending, so a photo's address never names other bytes and
 * its `immutable` header stays true.
 */
function readerFor<T>(schema: z.ZodType<T>, store: ReplayStore): ReportReader<T> {
  const folder = `field-reports/${randomUUID()}`
  let kept = 0
  return {
    accept: (body) => {
      const parsed = schema.safeParse(body)
      return parsed.success ? { report: parsed.data } : { refusals: refusalsIn(parsed.error) }
    },
    keep: async (photo, extension) => {
      kept += 1
      const path = `${folder}/${kept}.${extension}`
      await store.putMedia(path, photo)
      return path
    },
  }
}

/** An event gone is no conflict: the write that follows says it holds none. */
function holdsAll(event: ReplayEvent | undefined, paths: readonly string[]): boolean {
  return event === undefined || paths.every((path) => event.media.includes(path))
}

function dropped(change: ManualEventChange): string[] {
  return change.previous.media.filter((path) => !change.current.media.includes(path))
}

/**
 * After the rows, never before, so a failure leaves bytes nothing shows rather
 * than an event showing a photo that is gone: it is logged, and the change stands.
 */
async function removePhotos(
  routes: EventRoutes,
  { manifest, store }: Opened,
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    try {
      await store.removeMedia(path)
    } catch (error) {
      routes.log(
        `replay ${manifest.id} kept a photo it no longer shows, ${path}: ${describe(error)}`,
      )
    }
  }
}

function refuse(res: Response, refusal: Refusal): void {
  if (refusal.status === 413) contentTooLarge(res, refusal.detail)
  else if (refusal.status === 415) unsupportedMediaType(res, refusal.detail)
  else badRequest(res, refusal.detail, refusal.refusals)
}

/** A replay an event can be added to, or the answer saying why not. */
function acceptsReports(res: Response, manifest: ReplayManifest): boolean {
  const why = whyNotReportable(manifest)
  if (why !== undefined) conflict(res, why)
  return why === undefined
}

function whyNotReportable(manifest: ReplayManifest): string | undefined {
  // The registry knows only what this instance started; the manifest knows a
  // build another one runs.
  if (manifest.state === 'running') return `replay ${manifest.id} is being built`
  if (manifest.datasets.events === undefined) {
    return `replay ${manifest.id} holds no events data set`
  }
  return undefined
}
