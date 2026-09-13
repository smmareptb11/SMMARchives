import { medianStepOf } from '@smmarchives/shared/clock.ts'
import { boundingBoxSchema, type BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import type { RadarRainfallSeries } from '@smmarchives/shared/contracts/radar-rainfall.ts'
import type { DatasetStatus } from '@smmarchives/shared/contracts/replay.ts'

import { nearestTo, type Cursor } from './transport/reading.ts'

/**
 * Where the replay froze the delivered images, under its own media.
 *
 * The index holds the address an image came from inside the delivery, which is
 * not where the replay put it — `docs/utilisation.md` records the asymmetry with a
 * webcam, whose stored path carries its own prefix. Prefixed here and nowhere
 * else, so nothing downstream has to know the two differ.
 */
const FROZEN_UNDER = 'radar'

/** One delivered image, at the instant it was produced. */
export type Sheet = { at: Cursor; path: string }

/**
 * The products the replay holds an image of, shortest span first.
 *
 * Read off the deliveries and never off a list in the code: the live route
 * serves eight products where a delivery carries nine, and the documentation requires the
 * available ones to be deduced from what was delivered. Which also means a
 * product this file cannot read is kept — shown last, rather than dropped from
 * a menu that would then omit images the replay holds without saying so.
 *
 * On the images and not on the series, though. A series with no frame is
 * representable — the index and the frames are two tables — and choosing such a
 * product would empty the map and its lane with nothing saying why. The indexer
 * happens not to store one today, so this is the contract of the word
 * « product » here rather than a fix for a case seen in the wild.
 */
export function productsOf(series: readonly RadarRainfallSeries[]): string[] {
  const held = series.filter((one) => one.frames.length > 0)

  return [...new Set(held.map((one) => one.product))].sort(bySpan)
}

/**
 * The product a reader opens on: the hourly cumul, or the shortest one there is.
 *
 * Short enough to follow a squall across the basin and long enough to carry
 * something on an image — where the five-minute cumul, the palest of the nine,
 * reads as an empty map on a quiet hour.
 */
export function openingProductOf(series: readonly RadarRainfallSeries[]): string | undefined {
  const products = productsOf(series)

  return products.find((one) => one === AN_HOUR) ?? products[0]
}

const AN_HOUR = 'pluvio1h'

/** Unread names last, and among themselves by name, so the menu never shuffles. */
function bySpan(one: string, other: string): number {
  const mine = spanOf(one) ?? Number.MAX_SAFE_INTEGER
  const theirs = spanOf(other) ?? Number.MAX_SAFE_INTEGER

  return mine - theirs || one.localeCompare(other)
}

/** « Cumul 1 h », « Cumul 5 min » — the identifier itself when it reads as none. */
export function labelOf(product: string): string {
  const span = readSpan(product)

  return span === undefined ? product : `Cumul ${String(span.count)} ${span.unit}`
}

/**
 * The two shapes a product name has taken, as minutes.
 *
 * `pluvio5mn` and `pluvio24h` are the producer's own directory names, quoted
 * rather than translated. Nothing when the name is neither, which is the case
 * both the ordering and the label answer for.
 */
const SPAN = /^pluvio(\d+)(mn|h)$/

/**
 * The span a product name carries, read once for both the order and the label.
 *
 * `minutes` is what the ordering compares; `unit` is what a reader sees, which
 * is not the same thing — « Cumul 24 h » beside « Cumul 5 min » reads as two
 * spans, where the same two in minutes read as two numbers.
 */
function readSpan(product: string): { count: number; unit: string; minutes: number } | undefined {
  const [, count, unit] = SPAN.exec(product) ?? []
  if (count === undefined || unit === undefined) return undefined

  const figure = Number(count)
  return {
    count: figure,
    unit: unit === 'mn' ? 'min' : 'h',
    minutes: unit === 'mn' ? figure : figure * 60,
  }
}

function spanOf(product: string): number | undefined {
  return readSpan(product)?.minutes
}

/**
 * Every image of one product, oldest first, wherever it was delivered.
 *
 * Deliveries are merged rather than kept apart: they are periods of the same
 * product, and a replay straddling two of them would otherwise have to choose
 * which one the map draws.
 */
export function sheetsOf(series: readonly RadarRainfallSeries[], product: string): Sheet[] {
  return series
    .filter((one) => one.product === product)
    .flatMap((one) =>
      one.frames.map((frame) => ({
        at: Date.parse(frame.at),
        path: `${FROZEN_UNDER}/${frame.path}`,
      })),
    )
    .sort((one, other) => one.at - other.at)
}

/**
 * How far from the reading an image may have been produced and still be drawn.
 *
 * One production step, measured on the images themselves rather than taken from
 * a series: two deliveries merged carry two medians, and only the merged list
 * says how dense what is actually drawn turned out to be. It holds both cadences
 * the documentation records — five minutes up to the six-hour cumul, sixty above — without
 * either of them being written down.
 *
 * Nothing when there is no step to measure: one image says nothing about holes,
 * and refusing to draw it would hide the only thing the replay holds. A median
 * of zero is that same case reached another way — two deliveries carrying the
 * same instant of the same product — and taken at face value it would draw the
 * image on that millisecond alone.
 */
export function toleranceOf(sheets: readonly Sheet[]): number | undefined {
  const median = medianStepOf(sheets.map((one) => one.at))

  return median === null || median <= 0 ? undefined : median * 60_000
}

/**
 * The image to draw at an instant, or none.
 *
 * Nearest and not last-before, which is the webcams' rule: a radar image is
 * stamped with the time it was produced, so `AGENTS.md` requires matching to
 * the nearest neighbour. Past the tolerance nothing is drawn — a cumulative
 * rainfall image read twenty minutes after its own production, on a delivery
 * producing one every five, is a figure a reader would take for the one they
 * are looking at.
 */
export function sheetAt(
  sheets: readonly Sheet[],
  at: Cursor,
  tolerance: number | undefined,
): Sheet | undefined {
  const near = nearestTo(sheets, at)
  if (near === undefined) return undefined

  return tolerance === undefined || Math.abs(near.at - at) <= tolerance ? near : undefined
}

/**
 * The extent the collection actually used, out of the report it wrote.
 *
 * `AGENTS.md` files this one under « Unsettled — do not hardcode »: it is a
 * parameter, reported with the data, and taking the shared default instead
 * would draw a replay on an extent it was never indexed against without
 * anything on screen saying so.
 *
 * Nothing when the lane never ran, when the report carries none, and when what
 * it carries does not read as an extent — the report is an open record, so this
 * is the one place the value is checked. Nothing rather than a guess: a wrong
 * extent shifts the whole layer, and the shift is invisible on an image of rain.
 */
export function extentOf(status: DatasetStatus | undefined): BoundingBox | undefined {
  const read = boundingBoxSchema.safeParse(status?.report.extent)

  return read.success ? read.data : undefined
}

/**
 * What a replay can do with its rainfall, as one of three states.
 *
 * The switch in the panel, the layer on the map and the sentence under it all
 * rested on the same pair of conditions, written out in three files and kept in
 * step by hand — with three comments saying so. Named here, they cannot drift:
 * a family that appears for a layer nobody added would leave a switch doing
 * nothing, and the sentence would explain a drawing that never happened.
 */
export type RadarStanding = 'none' | 'unplaced' | 'drawable'

export function radarStandingOf(content: {
  series: readonly RadarRainfallSeries[]
  radarExtent: BoundingBox | undefined
}): RadarStanding {
  // On the images and not on the series: a delivery indexed with no frame in
  // the period leaves nothing to draw, whatever extent it was indexed against.
  if (!content.series.some((one) => one.frames.length > 0)) return 'none'

  return content.radarExtent === undefined ? 'unplaced' : 'drawable'
}
