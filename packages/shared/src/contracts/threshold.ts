import { z } from 'zod'

import { quantitySchema } from './quantity.ts'

/**
 * What a threshold actually is, which the API mixes in one set.
 *
 * Treating the three alike would invent a crossing at every historical flood
 * mark and invert the logic on drought scales, whose values decrease as the
 * situation worsens.
 */
export const thresholdNatureSchema = z.enum(['alert-level', 'flood-mark', 'drought-threshold'])

export type ThresholdNature = z.infer<typeof thresholdNatureSchema>

export const thresholdSchema = z.object({
  stationId: z.number().int(),
  /** Unique within a station *and a quantity*, not within a station. */
  id: z.number().int(),
  label: z.string(),
  quantity: quantitySchema,
  value: z.number(),
  nature: thresholdNatureSchema,
  /** True when the nature was inferred from the label rather than read. */
  natureIsFallback: z.boolean(),
  /** `htmlColor` as the API gives it, so a replay matches what agents read elsewhere. */
  color: z.string().nullable(),
})

export type Threshold = z.infer<typeof thresholdSchema>
