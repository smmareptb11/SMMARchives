import {
  cropToWindow,
  parseInstant,
  toEpochMilliseconds,
  webcamImageSchema,
  type BoundingBox,
  type ReportCollector,
  type TimeWindow,
  type WebcamImage,
} from '@smmarchives/shared'
import { z } from 'zod'

import type { LizmapClient } from '../lizmap/client.ts'
import { fetchWebcamPositions } from './webcams.ts'

/**
 * How long Ceneau keeps an image.
 *
 * `uri` and `thumb_uri` point at `media.ceneau.test`, not at SMMAR. A
 * replay older than this has no webcam images at all, and the interface must be
 * told so rather than shown an empty layer.
 */
export const RETENTION_DAYS = 30

const pictureSchema = z.looseObject({
  date: z.string(),
  uri: z.string(),
  thumb_uri: z.string().optional(),
})

const imageListSchema = z.looseObject({
  pictures: z.array(pictureSchema).default([]),
})

export type FetchImagesOptions = {
  client: LizmapClient
  collector: ReportCollector
  /**
   * Which cameras to read. Defaults to the exploitable ones from the positions
   * layer — the join lives here because only the connector knows that 19 of the
   * 24 cameras have no archive.
   */
  codes: readonly string[] | undefined
  /** Narrows the default camera list; ignored when `codes` is given. */
  extent?: BoundingBox | undefined
  window: TimeWindow | undefined
  /** Injected so the retention check is testable without freezing the clock. */
  now?: Date
}

export type ImagesResult = {
  images: WebcamImage[]
  /** The window predates Ceneau's retention: the absence is expected, not a defect. */
  beyondRetention: boolean
}

export async function fetchWebcamImages(options: FetchImagesOptions): Promise<ImagesResult> {
  const beyondRetention = isBeyondRetention(options.window, options.now ?? new Date())
  if (beyondRetention) {
    options.collector.fellBackTo({
      subject: 'requested window',
      rule: `Ceneau keeps images for ${RETENTION_DAYS} days`,
      applied: 'no image can exist for this period',
    })
  }

  const codes = options.codes ?? (await fetchWebcamPositions(options)).map((one) => one.code)
  const images: WebcamImage[] = []

  for (const code of codes) {
    options.collector.progress(`  webcam ${code}…`)
    try {
      const list = imageListSchema.parse(
        await options.client.getMedia(`/media/webcam/Ceneau_img_${code}.json`),
      )
      const ofCamera = decode(list.pictures, code, options)
      if (ofCamera.length === 0) options.collector.withoutData(code)
      images.push(...ofCamera)
    } catch (error) {
      options.collector.failed(`webcam ${code}`, error)
    }
  }

  return { images, beyondRetention }
}

function decode(
  pictures: readonly z.infer<typeof pictureSchema>[],
  code: string,
  options: FetchImagesOptions,
): WebcamImage[] {
  const decoded: WebcamImage[] = []
  let unusable = 0

  for (const picture of pictures) {
    try {
      const reduction = reductionOf(picture.thumb_uri)
      if (reduction.lost) unusable += 1

      decoded.push({
        code,
        at: parseInstant(picture.date, `webcam ${code} picture date`),
        uri: picture.uri,
        thumbUri: reduction.thumbUri,
      })
    } catch (error) {
      options.collector.failed(`webcam ${code} picture`, error)
    }
  }
  if (unusable > 0) sayTheReductionsHaveNoAddress(options, code, unusable)

  return options.window === undefined
    ? decoded
    : cropToWindow(decoded, options.window, (image) => image.at)
}

/**
 * The reduction's address when it is one, and whether one was published and lost.
 *
 * Two facts, because they are two: a camera that publishes no reduction and one
 * whose address is unusable both leave the image alone, and only the second is
 * worth reporting.
 *
 * The judgement is the contract's own — the listing declares `thumb_uri` a
 * string and nothing more, where a stored image must carry a `z.url()`. Writing
 * a second opinion here is what would let a value pass this door and fail the
 * next one, at the cost of every camera rather than one thumbnail.
 */
function reductionOf(published: string | undefined): { thumbUri: string | null; lost: boolean } {
  if (published === undefined) return { thumbUri: null, lost: false }

  const usable = webcamImageSchema.shape.thumbUri.safeParse(published).success
  return { thumbUri: usable ? published : null, lost: !usable }
}

/**
 * Says that reductions were read as absent, because their address is not one.
 *
 * The listing is checked no further than « it is a string », and the camera
 * layer this source joins already ships values that need cleaning. A reduction
 * is an economy and never the observation, so an address that is not one is
 * read as no reduction: the picture survives, and the full image stands in.
 *
 * Left through, it would reach the stored contract — which asks for a URL — and
 * cost the replay every camera rather than one thumbnail.
 *
 * One line per camera rather than per picture: a camera that publishes a
 * malformed address publishes it all day.
 */
function sayTheReductionsHaveNoAddress(
  options: FetchImagesOptions,
  code: string,
  count: number,
): void {
  options.collector.fellBackTo({
    subject: `webcam ${code} thumbnails`,
    rule: 'a reduction is addressed by a URL',
    applied: `${String(count)} read as no reduction, the full image standing in`,
  })
}

/** Only the past end matters: a window reaching into the future is not expired. */
function isBeyondRetention(window: TimeWindow | undefined, now: Date): boolean {
  if (window === undefined) return false
  return toEpochMilliseconds(window.to) < now.getTime() - RETENTION_DAYS * 86_400_000
}
