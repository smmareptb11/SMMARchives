import { z } from 'zod'

import {
  contains,
  eventPositionSchema,
  isWithin,
  parseInstant,
  SMMAR_TERRITORY,
  toEpochMilliseconds,
  type EventPosition,
  type Instant,
  type ReplayManifest,
} from '@smmarchives/shared'

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

/** What an agent writes of an event, whether reporting it or amending it. */
const REPORT_FIELDS = {
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
}

/**
 * What an agent reports, judged against the replay it is reported on.
 *
 * Bound to the manifest because an event outside the period would sit off the
 * timeline, and one outside the extent off the map: stored, and never seen.
 */
export function reportSchemaFor(manifest: ReplayManifest) {
  return z.strictObject(REPORT_FIELDS).superRefine(withinReplay(manifest))
}

/**
 * A report again, with the photos it keeps.
 *
 * Required rather than defaulted: an amendment that forgot the field would
 * otherwise remove every photo, which nobody asked for. Only the event's own
 * photos may be kept, so a client cannot attach a webcam image or another
 * event's photo by naming it.
 */
export function amendmentSchemaFor(manifest: ReplayManifest, held: readonly string[]) {
  return z
    .strictObject({
      ...REPORT_FIELDS,
      media: z
        .array(z.string())
        .refine((kept) => kept.every((path) => held.includes(path)), {
          message: 'names a photo the event does not hold',
        })
        .refine((kept) => new Set(kept).size === kept.length, {
          message: 'names a photo twice',
        }),
    })
    .superRefine(withinReplay(manifest))
}

export type Report = z.infer<ReturnType<typeof reportSchemaFor>>
export type Amendment = z.infer<ReturnType<typeof amendmentSchemaFor>>

type Placed = { from: Instant; to: Instant | null; position: EventPosition | null }

function withinReplay(manifest: ReplayManifest) {
  const extent = manifest.extent ?? SMMAR_TERRITORY
  return (report: Placed, context: z.RefinementCtx): void => {
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
  }
}

/** An extent is convex, so an area whose every vertex lies inside it lies inside it whole. */
function verticesOf(position: EventPosition): { lon: number; lat: number }[] {
  const points = position.type === 'Point' ? [position.coordinates] : position.coordinates.flat()
  return points.map(([lon, lat]) => ({ lon, lat }))
}
