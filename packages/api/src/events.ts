import { randomUUID } from 'node:crypto'

import express, { type Express, type Response } from 'express'
import type { z } from 'zod'

import type { ReplayManifest } from '@smmarchives/shared'
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

export function registerEvents(app: Express, routes: EventRoutes): void {
  app.post('/replays/:id/events', JSON_BODY, async (req, res) => {
    await withReportable(routes, res, req.params.id, async ({ manifest, store }) => {
      const read = await readReport(req, readerFor(reportSchemaFor(manifest), store))
      if ('status' in read) return refuse(res, read)

      res.status(201).json(await store.addManualEvent({ ...read.report, media: read.media }))
    })
  })

  app.put('/replays/:id/events/:eventId', JSON_BODY, async (req, res) => {
    await withReportable(routes, res, req.params.id, async (found) => {
      const { manifest, store } = found
      const previous = await store.getManualEvent(req.params.eventId)
      if (previous === undefined) return noSuchEvent(res, manifest)

      const schema = amendmentSchemaFor(manifest, previous.media)
      const read = await readReport(req, readerFor(schema, store))
      if ('status' in read) return refuse(res, read)

      // The photos kept, in the order the agent left them, then the new ones.
      const { media: kept, ...report } = read.report
      const change = await store.updateManualEvent(previous.id, {
        ...report,
        media: [...kept, ...read.media],
      })
      if (change === undefined) return noSuchEvent(res, manifest)

      await removePhotos(routes, found, dropped(change))
      res.json(change.current)
    })
  })

  app.delete('/replays/:id/events/:eventId', async (req, res) => {
    await withReportable(routes, res, req.params.id, async (found) => {
      const { manifest, store } = found
      const removed = await store.removeManualEvent(req.params.eventId)
      if (removed === undefined) return noSuchEvent(res, manifest)

      await removePhotos(routes, found, removed.media)
      res.status(204).end()
    })
  })
}

/**
 * Runs a change on a replay that can take one, or answers why it cannot.
 *
 * The replay is claimed for as long as the change is written, so a deletion
 * cannot carry it away underneath.
 */
async function withReportable(
  routes: EventRoutes,
  res: Response,
  id: string,
  change: (opened: Opened) => Promise<void>,
): Promise<void> {
  if (!checkedReplayId(res, id)) return
  if (!routes.builds.reserve(id)) {
    conflict(res, `replay ${id} is being built or deleted`)
    return
  }
  try {
    const found = await openReplay(routes.catalog, res, id)
    if (found === undefined || !acceptsReports(res, found.manifest)) return
    await change(found)
  } finally {
    routes.builds.release(id)
  }
}

/** Never the identifier asked for: it is the client's own text, and no schema cleared it. */
function noSuchEvent(res: Response, manifest: ReplayManifest): void {
  notFound(res, `replay ${manifest.id} holds no such event reported by an agent`)
}

/**
 * Judges the event against its replay, and keeps its photos where nothing else
 * will ever be written: a folder of their own for each sending, named at
 * random, so the address of a photo never names other bytes and its
 * `immutable` header stays true.
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

function dropped(change: ManualEventChange): string[] {
  return change.previous.media.filter((path) => !change.current.media.includes(path))
}

/**
 * After the rows, never before: a photo left behind is bytes nothing shows,
 * where the other order would leave an event showing a photo that is gone. So
 * a failure here is logged, and the change it follows still stands.
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
  // The registry knows only what this instance started; the manifest knows a
  // build another one runs.
  if (manifest.state === 'running') {
    conflict(res, `replay ${manifest.id} is being built`)
    return false
  }
  if (manifest.datasets.events === undefined) {
    conflict(res, `replay ${manifest.id} holds no events data set`)
    return false
  }
  return true
}
