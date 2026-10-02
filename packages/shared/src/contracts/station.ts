import { z } from 'zod'

import { positionSchema } from './geometry.ts'
import { quantitySchema } from './quantity.ts'

/**
 * The two families of Aquasys source.
 *
 * They are addressed by different endpoints, spell the same field differently,
 * and above all read the same `typeId` as different quantities. Nothing that
 * decodes a measure may ignore which family it came from.
 */
export const sourceFamilySchema = z.enum(['hydro', 'rain-gauge'])

export type SourceFamily = z.infer<typeof sourceFamilySchema>

/** What to call a source of each family in a report an operator reads. */
export const SOURCE_LABEL: Record<SourceFamily, string> = {
  hydro: 'station',
  'rain-gauge': 'rain gauge',
}

/**
 * How a station is rendered on the map.
 *
 * Read from the networks a station belongs to in Aquasys, since no field of the
 * station states it: `stationType` is `1` for the whole fleet.
 */
export const stationCategorySchema = z.enum(['watercourse', 'structure'])

export type StationCategory = z.infer<typeof stationCategorySchema>

export const stationSchema = z.object({
  id: z.number().int(),
  code: z.string().nullable(),
  name: z.string(),
  comment: z.string().nullable(),
  townCode: z.string().nullable(),
  altitude: z.number().nullable(),
  position: positionSchema.nullable(),
  category: stationCategorySchema,
  /**
   * Which of the collected quantities this source carries, read from its
   * measurement points, or `null` when details were not requested.
   */
  quantities: z.array(quantitySchema).nullable(),
})

export type Station = z.infer<typeof stationSchema>

export const rainGaugeSchema = z.object({
  id: z.number().int(),
  code: z.string().nullable(),
  name: z.string(),
  comment: z.string().nullable(),
  townCode: z.string().nullable(),
  altitude: z.number().nullable(),
  position: positionSchema.nullable(),
  quantities: z.array(quantitySchema).nullable(),
})

export type RainGauge = z.infer<typeof rainGaugeSchema>
