import { z } from 'zod'

import { instantSchema } from '../clock.ts'
import { quantitySchema } from './quantity.ts'
import { sourceFamilySchema } from './station.ts'

export const measureSchema = z.object({
  /** What `sourceId` is numbered in: the two families number their sources independently. */
  family: sourceFamilySchema,
  sourceId: z.number().int(),
  quantity: quantitySchema,
  at: instantSchema,
  value: z.number(),
})

export type Measure = z.infer<typeof measureSchema>

/**
 * The stations holding at least one measure over a replay's period: what tells,
 * without loading the measures, a station that crossed nothing from one that
 * measured nothing.
 */
export const measuredStationsSchema = z.array(z.number().int())
