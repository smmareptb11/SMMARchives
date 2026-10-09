import { randomUUID } from 'node:crypto'

import express, { type Express, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'

import {
  contains,
  eventProvenanceSchema,
  isWithin,
  SMMAR_TERRITORY,
  parseInstant,
  positionSchema,
  type Position,
  type ReplayEvent,
  type ReplayManifest,
} from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import type { ReplayStore } from '@smmarchives/worker/replay/store.ts'

import { imageExtensionOf } from './images.ts'
import {
  badRequest,
  conflict,
  describe,
  notFound,
  payloadTooLarge,
  refusalsIn,
  unsupportedMediaType,
} from './problems.ts'
import { openReplay } from './replays.ts'

/**
 * One instant, normalised onto the single clock, and never quoted back.
 *
 * Its zone is required, `Z` or an offset: a wall time without one would be
 * read in whatever zone the server runs in, and the same request would land
 * two hours apart from one host to the next.
 */
const instant = z.iso
  .datetime({ offset: true, error: 'must be an instant' })
  .transform((value, context) => {
    try {
      return parseInstant(value)
    } catch {
      context.addIssue({ code: 'custom', message: 'must be an instant' })
      return z.NEVER
    }
  })

/** Printable, save for the line breaks a description is written with. */
const printable = (text: string) =>
  [...text].every((one) => !/\p{Cc}/u.test(one) || '\n\r\t'.includes(one))

/**
 * What an agent may write of an event, and nothing the store settles.
 *
 * The title and the start are all an event needs: a fact can be dated before
 * it can be described or placed. An end left out is a point in time, which is
 * what the contract says of a null `to`; how long a reader sees it is the
 * interface's business.
 */
const manualEventSchema = z
  .strictObject({
    title: z
      .string()
      .trim()
      .min(1, 'must not be empty')
      .max(120)
      .regex(/^[^\p{Cc}]*$/u, 'must not carry control characters'),
    description: z
      .string()
      .trim()
      .max(4000)
      .refine(printable, 'must not carry control characters')
      .nullish()
      .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
    from: instant,
    to: instant.nullish().transform((value) => value ?? null),
    position: positionSchema.nullish().transform((value) => value ?? null),
    provenance: eventProvenanceSchema.nullish().transform((value) => value ?? null),
  })
  .refine((event) => event.to === null || Date.parse(event.from) <= Date.parse(event.to), {
    message: 'ends before it starts',
    path: ['to'],
  })

/**
 * What falls outside the replay, as a schema would name it.
 *
 * Refused rather than kept: a fact outside the period, or outside the extent,
 * is one no reader of this replay would ever be shown. A replay with no extent
 * covers the territory, and is held to it.
 */
function outsideOf(
  manifest: ReplayManifest,
  event: { from: string; to: string | null; position: Position | null },
) {
  const ends = (['from', 'to'] as const)
    .filter((end) => {
      const at = event[end]
      return at !== null && !isWithin(at, manifest.period)
    })
    .map((path) => ({ path, message: 'must fall within the period of the replay' }))

  const { position } = event
  const placed =
    position === null || contains(manifest.extent ?? SMMAR_TERRITORY, position)
      ? []
      : [{ path: 'position', message: 'must fall within the extent of the replay' }]

  return [...ends, ...placed]
}

export type EventRoutes = {
  catalog: ReplayCatalog
  /** The heaviest image accepted, in bytes. */
  imageLimit: number
  /** Where what a response cannot say is said instead. */
  log: (message: string) => void
}

/**
 * Adding an event an agent wrote, its image, and what the API accepts of it.
 *
 * Registered before the replays' routes: `/replays/limits` would otherwise be
 * taken for a replay named `limits`. None is, a replay's identifier being a
 * UUID the database mints, and the other routes here share no method and path
 * with those.
 */
export function registerEvents(app: Express, routes: EventRoutes): void {
  const { catalog } = routes

  // What the form asks once, to refuse an image before an event exists to
  // attach it to.
  app.get('/replays/limits', (_req, res) => {
    res.json({ manualImageBytes: routes.imageLimit })
  })

  app.post('/replays/:id/events', express.json({ limit: '64kb' }), async (req, res) => {
    const opened = await openReplay(catalog, res, req.params.id)
    if (opened === undefined) return

    const parsed = manualEventSchema.safeParse(req.body)
    if (!parsed.success) {
      badRequest(res, 'the event is not described correctly', refusalsIn(parsed.error))
      return
    }
    const outside = outsideOf(opened.manifest, parsed.data)
    if (outside.length > 0) {
      badRequest(res, 'the event is not described correctly', outside)
      return
    }

    res.status(201).json(await opened.store.addManualEvent(parsed.data))
  })

  // Any declared type: what the bytes are is read from them, not from the
  // header, and a client sending `application/octet-stream` is not wrong.
  const readImage = express.raw({ type: () => true, limit: routes.imageLimit })

  app.put('/replays/:id/events/:eventId/image', async (req, res) => {
    const opened = await openReplay(catalog, res, req.params.id)
    if (opened === undefined) return

    const event = await eventToHold(opened.store, res, req.params)
    if (event === undefined) return

    // Read only now, once the replay and the event are known: a request for
    // either that does not exist is answered without the image ever being
    // held in memory or looked at. Node still drains what the client sends.
    const image = await imageIn(req, res, readImage, routes.imageLimit)
    if (image === undefined) return
    const { body, extension } = image

    // A name of its own, never the one sent: the address is served as
    // immutable, so it must never come to name other bytes.
    const path = `manual/${event.id}/${randomUUID()}.${extension}`
    await opened.store.putMedia(path, body)
    if (!(await attached(opened.store, event.id, path, routes.log))) {
      conflict(res, HOLDS_ONE)
      return
    }

    res.status(201).json({ ...event, media: [path] })
  })
}

const HOLDS_ONE = 'only an event an agent wrote takes an image, and only one'

/**
 * Whether the bytes just written became the event's image.
 *
 * Another request may have attached one in between, or the record may fail to
 * be written: either way nothing names these bytes, and they are taken away
 * rather than left to pile up on the volume. A removal that fails is logged
 * and never thrown: the error worth raising is the one that left the bytes
 * unnamed, and a second one would take its place.
 */
async function attached(
  store: ReplayStore,
  eventId: string,
  path: string,
  log: (message: string) => void,
): Promise<boolean> {
  let held = false
  try {
    held = await store.attachEventMedia(eventId, path)
    return held
  } finally {
    if (!held) {
      await store.removeMedia(path).catch((error: unknown) => {
        log(`an image no event holds stayed on the volume, at ${path}: ${describe(error)}`)
      })
    }
  }
}

/** The image sent and the format its bytes say, or the answer saying why not. */
async function imageIn(
  req: Request,
  res: Response,
  read: RequestHandler,
  limit: number,
): Promise<{ body: Buffer; extension: string } | undefined> {
  try {
    await new Promise<void>((settle, fail) => {
      void read(req, res, (error?: unknown) => {
        if (error === undefined) settle()
        else fail(error instanceof Error ? error : new Error('unreadable body', { cause: error }))
      })
    })
  } catch (error) {
    if ((error as { status?: unknown }).status !== 413) throw error
    payloadTooLarge(res, `an image weighs at most ${String(limit)} bytes`)
    return undefined
  }

  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const extension = imageExtensionOf(body)
  if (extension !== undefined) return { body, extension }
  unsupportedMediaType(res, 'an event takes a JPEG, a PNG or a WebP image')
  return undefined
}

/**
 * The event an image is meant for, or the answer saying why there is none.
 *
 * Looked up among the replay's own before its identifier goes anywhere near a
 * path: only an identifier the database minted ever names a directory.
 */
async function eventToHold(
  store: ReplayStore,
  res: Response,
  params: { id: string; eventId: string },
): Promise<ReplayEvent | undefined> {
  const event = await store.getEvent(params.eventId)

  // The event identifier is the client's text, so no answer repeats it.
  if (event === undefined) notFound(res, `replay ${params.id} holds no such event`)
  else if (!canHold(event)) conflict(res, HOLDS_ONE)
  else return event
  return undefined
}

/**
 * Asked before the bytes are read, so a refusal costs nothing. The store asks
 * again as it attaches, which is what holds between two requests at once.
 */
function canHold(event: ReplayEvent): boolean {
  return event.origin === 'manual' && event.media.length === 0
}
