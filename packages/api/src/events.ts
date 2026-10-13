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

import type { BuildRegistry } from './builds.ts'
import { badRequest, conflict, refusalsIn } from './problems.ts'
import { checkedReplayId, openReplay } from './replays.ts'

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

      const parsed = reportSchemaFor(opened.manifest).safeParse(req.body)
      if (!parsed.success) {
        badRequest(res, 'the event is not described correctly', refusalsIn(parsed.error))
        return
      }

      res.status(201).json(await opened.store.addManualEvent({ ...parsed.data, media: [] }))
    } finally {
      builds.release(id)
    }
  })
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
