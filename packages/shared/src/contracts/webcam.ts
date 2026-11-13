import { z } from 'zod'

import { instantSchema } from '../clock.ts'
import { positionSchema } from './geometry.ts'

export const webcamSchema = z.object({
  /** Join key towards the image lists. */
  code: z.string(),
  commune: z.string(),
  url: z.string(),
  operational: z.boolean(),
  position: positionSchema,
})

export type Webcam = z.infer<typeof webcamSchema>

export const webcamImageSchema = z.object({
  code: z.string(),
  at: instantSchema,
  uri: z.url(),
  /** Ready-made reduction, to use for map markers rather than shrinking `uri`. */
  thumbUri: z.url().nullable(),
})

export type WebcamImage = z.infer<typeof webcamImageSchema>

/**
 * An image once a replay holds its own copy, which it needs because Ceneau keeps
 * an image for a month only. Apart from {@link webcamImageSchema}, since where a
 * copy lives is not a property of the observation.
 */
export const frozenWebcamImageSchema = webcamImageSchema.extend({
  /**
   * Where the copy lives, relative to the replay's `media/`. Null when the run
   * asked for no media or the fetch failed; a period older than the retention
   * yields no entry at all.
   */
  storedPath: z.string().nullable(),
  /**
   * Where the copy of Ceneau's own reduction lives, under the same root. Null
   * when the replay has none, `thumbUri` being unpublished or its download
   * failed: the full image then stands in for it.
   */
  storedThumbPath: z.string().nullable(),
})

export type FrozenWebcamImage = z.infer<typeof frozenWebcamImageSchema>
