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
 * An image once a replay holds its own copy.
 *
 * Separate from {@link webcamImageSchema} rather than a field on it, because
 * where a copy lives is not a property of the observation: the source reader
 * would have to carry a slot it can only ever leave empty, and a consumer of
 * the raw image would inherit a field meaningless outside a replay. The radar
 * frames make the same distinction the other way round — their `path` is the
 * address they came from, not the one they were frozen at.
 *
 * `uri` points at `media.ceneau.test`, which keeps an image for a month: a
 * replay holding only the URL empties itself without warning once that month
 * has passed, which is what the copy is for.
 */
export const frozenWebcamImageSchema = webcamImageSchema.extend({
  /**
   * Where the copy lives, relative to the replay's `media/`.
   *
   * Null in two cases: a run asked for no media, and an image the fetch did not
   * return. A period older than the retention yields no entry at all rather
   * than a null one, so it is not one of them.
   */
  storedPath: z.string().nullable(),
  /**
   * Where the copy of Ceneau's own reduction lives, under the same root.
   *
   * A field of its own rather than a path derived from `storedPath`, because a
   * reader has to tell a reduction the replay holds from one it never had:
   * `thumbUri` is not always published, and a download of it is allowed to fail
   * without costing the observation. Null is that, and the full image stands in
   * for it — at some six hundred kilobytes against four.
   */
  storedThumbPath: z.string().nullable(),
})

export type FrozenWebcamImage = z.infer<typeof frozenWebcamImageSchema>
