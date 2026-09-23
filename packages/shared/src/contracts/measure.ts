import { z } from 'zod'

import { instantSchema } from '../clock.ts'
import { quantitySchema } from './quantity.ts'

export const measureSchema = z.object({
  sourceId: z.number().int(),
  quantity: quantitySchema,
  at: instantSchema,
  value: z.number(),
})

export type Measure = z.infer<typeof measureSchema>
