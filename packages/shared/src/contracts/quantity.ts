import { z } from 'zod'

/**
 * The three quantities SMMARchives collects.
 *
 * Aquasys exposes more — battery voltage, wind, evapotranspiration — and none
 * of it is modelled here: the application replays water levels, flows and
 * rainfall, and a quantity absent from this enum is one the collectors cannot
 * silently pick up.
 */
export const quantitySchema = z.enum(['level', 'flow', 'rainfall'])

export type Quantity = z.infer<typeof quantitySchema>
