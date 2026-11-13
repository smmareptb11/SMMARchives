import { z } from 'zod'

import { instantSchema, toEpochMilliseconds } from '../clock.ts'
import { thresholdSchema } from './threshold.ts'

/**
 * Where an event came from: a crossing a computation detected, or an analysis an
 * agent wrote. Both share one structure, so the timeline and the event feed hold
 * one kind of thing; what differs is who may edit it.
 */
export const eventOriginSchema = z.enum(['automatic', 'manual'])

/** What kind of fact the event is: a crossing the replay derived, or what an agent reported. */
export const eventCategorySchema = z.enum(['threshold-crossing', 'field-report'])

const coordinatesSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

/** Where the event happened, in GeoJSON: a spot, or an area such as a flooded field. */
export const eventPositionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: coordinatesSchema }),
  z.object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(
        z
          .array(coordinatesSchema)
          .min(4)
          .refine(isClosed, 'is not closed')
          .refine(enclosesSomething, 'encloses nothing')
          .refine((ring) => !crossesItself(ring), 'crosses itself'),
      )
      .min(1),
  }),
])

export type EventPosition = z.infer<typeof eventPositionSchema>

type Vertex = [number, number]

function isClosed(ring: Vertex[]): boolean {
  const first = ring[0]
  const last = ring.at(-1)
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]
}

/**
 * Whether a closed ring has an area, which being closed does not ensure: PostGIS
 * stores a flat ring as a geometry the map never shows. Shared so the form
 * judges a traced area as the API will.
 */
export function enclosesSomething(ring: readonly Vertex[]): boolean {
  return Math.abs(twiceTheArea(ring)) > 0
}

/** The shoelace formula, over a ring closed on its first vertex. */
function twiceTheArea(ring: readonly Vertex[]): number {
  let sum = 0
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [x1, y1] = ring[index]!
    const [x2, y2] = ring[index + 1]!
    sum += x1 * y2 - x2 * y1
  }
  return sum
}

/**
 * Whether two sides of a closed ring meet anywhere but at the vertex they share:
 * a bow tie, or a side doubling back over another. A vertex repeated in a row
 * does not count.
 */
export function crossesItself(ring: readonly Vertex[]): boolean {
  const vertices = ring.filter(
    (one, index) => index === 0 || one[0] !== ring[index - 1]![0] || one[1] !== ring[index - 1]![1],
  )
  const sides = vertices.length - 1
  for (let one = 0; one < sides; one += 1) {
    for (let other = one + 1; other < sides; other += 1) {
      // Neighbours share a vertex, the first and the last side included.
      if (other === one + 1 || (one === 0 && other === sides - 1)) continue
      if (meet(vertices[one]!, vertices[one + 1]!, vertices[other]!, vertices[other + 1]!)) {
        return true
      }
    }
  }
  return false
}

/** Whether two segments touch, an end lying on the other segment included. */
function meet(a: Vertex, b: Vertex, c: Vertex, d: Vertex): boolean {
  // Each end of a segment, seen from the line through the other one.
  const seen: [Vertex, Vertex, Vertex][] = [
    [a, b, c],
    [a, b, d],
    [c, d, a],
    [c, d, b],
  ]
  const [abc, abd, cda, cdb] = seen.map(([p, q, r]) => turn(p, q, r)) as [
    number,
    number,
    number,
    number,
  ]
  if (abc * abd < 0 && cda * cdb < 0) return true
  return seen.some(([p, q, r]) => turn(p, q, r) === 0 && within(p, q, r))
}

/** Which way `c` lies from the line through `a` and `b`: left, right, or on it. */
function turn(a: Vertex, b: Vertex, c: Vertex): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
}

/** Whether `c`, already on the line through `a` and `b`, lies between them. */
function within(a: Vertex, b: Vertex, c: Vertex): boolean {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  )
}

/**
 * Whether a link an agent joins opens a web page, and nothing else: anyone
 * reading the replay may follow it, and a `javascript:` address would run in
 * their page. Shared so the form judges a link as the API will.
 */
export function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * What a crossing rests on, copied into the event it produced rather than
 * pointed to: the measure and the threshold as they were when the replay was
 * generated.
 */
export const thresholdCrossingSchema = thresholdSchema
  .pick({ label: true, quantity: true, value: true, natureIsFallback: true })
  .extend({
    thresholdId: z.number().int(),
    /**
     * The value of the measure that crossed it, never a maximum over the episode:
     * `value: 2.8, measured: 3.604` would read as a Vigilance crossed with the
     * flood peak.
     */
    measured: z.number(),
    /** The highest value observed while above, which is the crest of the episode. */
    peak: z.number(),
    /**
     * How many rungs the ladder has, without which a rank says nothing across
     * stations: rank 2 of 2 is the top of the scale, rank 2 of 5 is not.
     */
    ladderHeight: z.number().int().positive(),
    /**
     * It never came back below within the period: `to` is then the last instant
     * measured, not a fall, and only the series could tell the two apart.
     * Whether it predates the period needs no field: it is `from <= period.from`.
     */
    stillActiveAtEnd: z.boolean(),
  })

export type ThresholdCrossing = z.infer<typeof thresholdCrossingSchema>

/**
 * A fact that matters to the analysis, deliberately not the observation that
 * produced it: editing or deleting an event leaves the measure alone, and a
 * connector can add a station without touching the timeline.
 */
export const eventSchema = z
  .object({
    /**
     * Derived from what the event is about, never from a counter, so an event
     * an agent set aside stays recognisable.
     */
    id: z.string(),
    origin: eventOriginSchema,
    category: eventCategorySchema,
    title: z.string(),
    /** What the agent wrote of it. */
    description: z.string().nullable(),
    /** Who reported it, as the agent wrote it: an SMMAR agent, a commune, the SDIS… */
    producerKind: z.string().nullable(),
    /** A page the agent pointed to: a post, an article, a video. */
    link: z.string().refine(isWebAddress, 'must be an http or https address').nullable(),
    /**
     * The rank of the threshold in the ladder of its station and quantity, 1
     * being the lowest: a rank, not a business category, since nothing
     * establishes its mapping onto Situation, Informatif and Contrôle.
     */
    severity: z.number().int().positive().nullable(),
    /** `htmlColor` as the API gives it, so a replay matches what agents read elsewhere. */
    color: z.string().nullable(),
    from: instantSchema,
    /** Null is a point in time; a value means it stayed active until then. */
    to: instantSchema.nullable(),
    position: eventPositionSchema.nullable(),
    sourceId: z.number().int().nullable(),
    /** The photos an agent joined, as paths relative to the replay's `media/`. */
    media: z.array(z.string()),
    crossing: thresholdCrossingSchema.nullable(),
  })
  // As time, never as strings: an instant may carry seconds or milliseconds, and
  // `.` sorts before `Z`.
  .refine(
    (event) =>
      event.to === null || toEpochMilliseconds(event.from) <= toEpochMilliseconds(event.to),
    { message: 'ends before it starts', path: ['to'] },
  )
  .refine((event) => event.origin !== 'manual' || (event.producerKind ?? '') !== '', {
    message: 'names no producer kind',
    path: ['producerKind'],
  })

export type ReplayEvent = z.infer<typeof eventSchema>
