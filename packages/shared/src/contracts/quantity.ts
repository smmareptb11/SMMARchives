import { z } from 'zod'

/**
 * The three quantities SMMARchives collects, of the many Aquasys exposes: one
 * absent from this enum is one a collector cannot silently pick up.
 */
export const quantitySchema = z.enum(['level', 'flow', 'rainfall'])

export type Quantity = z.infer<typeof quantitySchema>
