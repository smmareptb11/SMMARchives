import { fromEpochMilliseconds, type TimeWindow } from '@smmarchives/shared/clock.ts'
import type { FrozenWebcamImage } from '@smmarchives/shared/contracts/webcam.ts'

import { formatSince } from './time.ts'
import { lastBefore, type Cursor } from './transport/reading.ts'

/** A view the replay holds a picture of, with its instant already read. */
export type View = {
  at: Cursor
  /** The reduction when the replay froze one, the full image otherwise. */
  path: string
  /** The full image, when the replay holds it: what a reader gets on demand. */
  full: string | undefined
}

/** The views of every camera, by code, oldest first. */
export type Views = ReadonlyMap<string, readonly View[]>

/**
 * What a replay holds of each camera, read once for a reading that lasts.
 *
 * A view whose two downloads both failed is left out: whoever draws a camera
 * asks this rather than reading the paths, or the strip and the map disagree
 * about which views the replay holds. The instants are parsed here and never
 * again — `transport/reading.ts` keeps the cursor a number for the same reason.
 */
export function viewsOf(images: readonly FrozenWebcamImage[]): Views {
  const byCamera = new Map<string, View[]>()

  for (const image of images) {
    const path = image.storedThumbPath ?? image.storedPath
    if (path === null) continue

    const held = byCamera.get(image.code) ?? []
    held.push({ at: Date.parse(image.at), path, full: image.storedPath ?? undefined })
    byCamera.set(image.code, held)
  }

  for (const held of byCamera.values()) held.sort((one, other) => one.at - other.at)
  return byCamera
}

/** A view as the ruler wants it, since a lane knows dates and never numbers. */
export function instantOf(view: View) {
  return fromEpochMilliseconds(view.at)
}

/**
 * When the view shown was taken, seen from the instant read.
 *
 * A camera that went dark goes on showing its last view, which would otherwise
 * read as the scene at that instant.
 */
export function takenWhen(view: View, at: Cursor): string {
  return `Image prise ${formatSince(instantOf(view), fromEpochMilliseconds(at))}`
}

/**
 * What a camera showed at an instant: its last view before it.
 *
 * A view holds until the next one is taken — the rule the lane's strip draws
 * from the same list, which is what makes the two views of a replay agree.
 * Nothing before the camera looked for the first time, which is not the same
 * as a camera showing black.
 */
export function viewAt(views: Views, code: string, at: Cursor): View | undefined {
  const held = views.get(code)
  return held === undefined ? undefined : lastBefore(held, at)
}

/** Where the view at an instant stands among a camera's views, and the ones either side. */
export type Steps = {
  /** Its rank among the views of the period, from 0; nothing when it is not one of them. */
  index: number | undefined
  /** How many views the camera holds within the period. */
  count: number
  previous: Cursor | undefined
  /** The first view, when the cursor is before every one. */
  next: Cursor | undefined
}

/**
 * The views on either side of the one shown, for stepping from view to view.
 *
 * Read with the same rule as `viewAt`, so a step lands the cursor on the very
 * instant of a view and the view shown is that one. A step always reaches
 * another instant — two views taken at once are one stop — and stays within
 * the period, which is where the reading can go: a step that cannot move the
 * cursor is no step.
 */
export function viewStepsOf(views: Views, code: string, at: Cursor, period: TimeWindow): Steps {
  const from = Date.parse(period.from)
  const to = Date.parse(period.to)
  const within = (views.get(code) ?? []).filter((one) => one.at >= from && one.at <= to)
  const shown = viewAt(views, code, at)
  const index = shown === undefined ? -1 : within.indexOf(shown)

  return {
    index: index < 0 ? undefined : index,
    count: within.length,
    previous: within.findLast((one) => one.at < (shown?.at ?? at))?.at,
    next: within.find((one) => one.at > at)?.at,
  }
}
