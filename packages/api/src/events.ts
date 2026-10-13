import { randomUUID } from 'node:crypto'

import express, { type Express, type Response } from 'express'
import { z } from 'zod'

import {
  contains,
  eventPositionSchema,
  isWithin,
  parseInstant,
  SMMAR_TERRITORY,
  toEpochMilliseconds,
  type EventPosition,
  type ReplayManifest,
} from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import type { ReplayStore } from '@smmarchives/worker/replay/store.ts'

import type { BuildRegistry } from './builds.ts'
import {
  badRequest,
  conflict,
  contentTooLarge,
  refusalsIn,
  unsupportedMediaType,
} from './problems.ts'
import { checkedReplayId, openReplay } from './replays.ts'
import { readReport, type Refusal, type ReportReader } from './uploads.ts'

/** A line of text, printable, the way a label is. */
function line(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, 'must not carry control characters')
}

const instant = z.string().transform((value, context) => {
  try {
    return parseInstant(value)
  } catch {
    // Its own message: `parseInstant` quotes what it was given, and no response
    // body repeats a client's text.
    context.addIssue({ code: 'custom', message: 'must be an instant' })
    return z.NEVER
  }
})

/**
 * What an agent reports, judged against the replay it is reported on.
 *
 * Bound to the manifest because an event outside the period would sit off the
 * timeline, and one outside the extent off the map: stored, and never seen.
 */
function reportSchemaFor(manifest: ReplayManifest) {
  const extent = manifest.extent ?? SMMAR_TERRITORY
  return z
    .strictObject({
      title: line(200),
      description: z
        .string()
        .max(5_000)
        // Several paragraphs are a description; any other control character is not.
        .refine((value) => !/[^\P{Cc}\t\n\r]/u.test(value), 'must not carry control characters')
        .nullish()
        .transform((value) => value ?? null),
      producerKind: line(100),
      from: instant,
      to: instant.nullish().transform((value) => value ?? null),
      position: eventPositionSchema.nullish().transform((value) => value ?? null),
    })
    .superRefine((report, context) => {
      if (!isWithin(report.from, manifest.period)) {
        context.addIssue({
          code: 'custom',
          path: ['from'],
          message: 'lies outside the replay period',
        })
      }
      if (report.to !== null) {
        if (!isWithin(report.to, manifest.period)) {
          context.addIssue({
            code: 'custom',
            path: ['to'],
            message: 'lies outside the replay period',
          })
        } else if (toEpochMilliseconds(report.to) < toEpochMilliseconds(report.from)) {
          context.addIssue({ code: 'custom', path: ['to'], message: 'ends before it starts' })
        }
      }
      if (
        report.position !== null &&
        !verticesOf(report.position).every((at) => contains(extent, at))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['position'],
          message: 'lies outside the replay extent',
        })
      }
    })
}

/** An extent is convex, so an area whose every vertex lies inside it lies inside it whole. */
function verticesOf(position: EventPosition): { lon: number; lat: number }[] {
  const points = position.type === 'Point' ? [position.coordinates] : position.coordinates.flat()
  return points.map(([lon, lat]) => ({ lon, lat }))
}

export type EventRoutes = {
  catalog: ReplayCatalog
  builds: BuildRegistry
}

export function registerEvents(app: Express, routes: EventRoutes): void {
  const { builds, catalog } = routes
  app.post('/replays/:id/events', express.json({ limit: '64kb' }), async (req, res) => {
    const { id } = req.params
    if (!checkedReplayId(res, id)) return

    // Claimed for as long as the event is written, so a deletion cannot carry
    // the replay away underneath it.
    if (!builds.reserve(id)) {
      conflict(res, `replay ${id} is being built or deleted`)
      return
    }
    try {
      const opened = await openReplay(catalog, res, id)
      if (opened === undefined || !acceptsReports(res, opened.manifest)) return

      const read = await readReport(req, readerFor(opened.manifest, opened.store))
      if ('status' in read) {
        refuse(res, read)
        return
      }

      res.status(201).json(await opened.store.addManualEvent({ ...read.report, media: read.media }))
    } finally {
      builds.release(id)
    }
  })
}

type Report = z.infer<ReturnType<typeof reportSchemaFor>>

/**
 * Judges the event against its replay, and keeps its photos where nothing else
 * will ever be written: a folder of their own, named at random, so the address
 * of a photo never names other bytes and its `immutable` header stays true.
 */
function readerFor(manifest: ReplayManifest, store: ReplayStore): ReportReader<Report> {
  const schema = reportSchemaFor(manifest)
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
