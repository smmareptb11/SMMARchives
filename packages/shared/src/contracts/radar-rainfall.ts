import { z } from 'zod'

import { instantSchema } from '../clock.ts'

export const radarRainfallFrameSchema = z.object({
  at: instantSchema,
  /** Relative to the deliveries root, so the index survives a move of the volume. */
  path: z.string(),
})

export type RadarRainfallFrame = z.infer<typeof radarRainfallFrameSchema>

/**
 * One product of one delivery, its frames sorted by instant.
 *
 * Sorted because filenames are production times, not slots: the consumer picks
 * the nearest neighbour within a tolerance and never computes a filename from a
 * target time.
 */
export const radarRainfallSeriesSchema = z.object({
  delivery: z.string(),
  product: z.string(),
  medianStepMinutes: z.number().nullable(),
  frames: z.array(radarRainfallFrameSchema),
})

export type RadarRainfallSeries = z.infer<typeof radarRainfallSeriesSchema>
