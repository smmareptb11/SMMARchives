import { z } from 'zod'

import { instantSchema } from '../clock.ts'
import { positionSchema } from './geometry.ts'
import { thresholdSchema } from './threshold.ts'

/**
 * Where an event came from.
 *
 * The two share one structure, on purpose: a crossing a computation detected and
 * an analysis an agent wrote carry the same attributes, so the timeline and the
 * event feed hold one kind of thing. What differs is who may edit it.
 */
export const eventOriginSchema = z.enum(['automatic', 'manual'])

/**
 * What kind of fact the event is.
 *
 * Only the one the replay derives today. The categories an agent will choose
 * from arrive with the administration; naming them here before anything can
 * produce them would be a vocabulary nobody speaks.
 */
export const eventCategorySchema = z.enum(['threshold-crossing'])

/**
 * What a crossing rests on, kept with the event it produced.
 *
 * Editing or deleting an event never alters the observation behind it, so the
 * event carries a copy of what it read rather than a pointer to it: the measure
 * and the threshold as they were when the replay was generated.
 */
export const thresholdCrossingSchema = thresholdSchema
  .pick({ label: true, quantity: true, value: true, natureIsFallback: true })
  .extend({
    thresholdId: z.number().int(),
    /**
     * The value of the measure that crossed it, and nothing else.
     *
     * The judgement bears on the value at the instant, with no accumulation, so
     * this cannot be a maximum over the episode: `value: 2.8, measured: 3.604`
     * would read as a Vigilance crossed with the flood peak.
     */
    measured: z.number(),
    /** The highest value observed while above, which is the crest of the episode. */
    peak: z.number(),
    /**
     * How many rungs the ladder has.
     *
     * A rank alone says nothing across stations: rank 2 of 2 is the top of the
     * scale, rank 2 of 5 is not, and a feed sorting on the rank would put a
     * minor alert above a Crise.
     */
    ladderHeight: z.number().int().positive(),
    /**
     * It never came back below within the period, so the end is the last instant
     * measured, which may fall well short of the period's own end.
     *
     * Not derivable from the event: only the series says whether `to` is the
     * last measurement or a genuine fall. Whether the crossing predates the
     * period, by contrast, is `from <= period.from` and the period is on the
     * manifest, so nothing stores it.
     */
    stillActiveAtEnd: z.boolean(),
  })

export type ThresholdCrossing = z.infer<typeof thresholdCrossingSchema>

/**
 * A fact that matters to the analysis.
 *
 * Deliberately not the observation that produced it: editing or deleting an
 * event leaves the measure alone, and a station can be added by a connector
 * without touching the timeline.
 */
export const eventSchema = z
  .object({
    /**
     * Derived from what the event is about, never from a counter.
     *
     * A regeneration recomputes the same identifiers, so a re-run creates no
     * duplicate and an event an agent set aside stays recognisable.
     */
    id: z.string(),
    origin: eventOriginSchema,
    category: eventCategorySchema,
    title: z.string(),
    /**
     * The rank of the threshold in the ladder of its station and quantity, 1
     * being the lowest.
     *
     * A rank, not a business category: the mapping onto Situation, Informatif
     * and Contrôle is established nowhere, and nothing here invents it.
     */
    severity: z.number().int().positive().nullable(),
    /** `htmlColor` as the API gives it, so a replay matches what agents read elsewhere. */
    color: z.string().nullable(),
    from: instantSchema,
    /** Null is a point in time; a value means it stayed active until then. */
    to: instantSchema.nullable(),
    position: positionSchema.nullable(),
    sourceId: z.number().int().nullable(),
    /** Paths relative to the replay's `media/`. */
    media: z.array(z.string()),
    crossing: thresholdCrossingSchema.nullable(),
  })
  .refine((event) => event.to === null || event.from <= event.to, {
    message: 'ends before it starts',
    path: ['to'],
  })

export type ReplayEvent = z.infer<typeof eventSchema>
