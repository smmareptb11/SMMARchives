import { z } from 'zod'

import { featureCollectionSchema } from './geometry.ts'

export const referenceLayerSchema = z.object({
  /** The Lizmap layer name, kept as the remote project spells it. */
  name: z.string(),
  featureCount: z.number().int().nonnegative(),
  /** WGS84: Lizmap reprojects on output, whatever its WFS `GetCapabilities` announces. */
  geojson: featureCollectionSchema,
})

export type ReferenceLayer = z.infer<typeof referenceLayerSchema>
