import type { Measure } from '@smmarchives/shared/contracts/measure.ts'
import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'
import { UNITS } from '@smmarchives/shared'
import type { Threshold } from '@smmarchives/shared/contracts/threshold.ts'

import { lastBefore, type Cursor } from '../transport/reading.ts'

export type Reading = { at: Cursor; value: number }

/**
 * A measured value as the interface writes it, which is in French.
 *
 * Two decimals at most: Aquasys gives a flow to the centilitre, and a bubble
 * reading `3.0700000000000003 m³/s` says less than one reading `3,07`.
 */
const MEASURED = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

export function formatValue(value: number): string {
  return MEASURED.format(value)
}

export type Series = { quantity: Quantity; unit: string; points: Reading[] }

/**
 * The quantity a station is watched on, which is the one worth showing.
 *
 * Its alert ladder says it: a mark of a past flood says what was reached once,
 * never what is being watched, and a drought scale reads the other way round.
 *
 * A ladder bearing on two quantities — the contract allows it, a threshold's
 * identifier being unique within a station *and* a quantity — is read on the
 * one carrying the most thresholds. The richest ladder is the one the station
 * is really judged against, and the order the replay froze them in decides
 * nothing.
 */
export function watchedQuantity(thresholds: readonly Threshold[], stationId: number): Quantity {
  const counted = new Map<Quantity, number>()

  for (const one of thresholds) {
    if (one.stationId !== stationId || one.nature !== 'alert-level') continue
    counted.set(one.quantity, (counted.get(one.quantity) ?? 0) + 1)
  }

  // Twenty-two of the ninety-four stations of a whole-parc replay carry no alert
  // ladder at all, and a station has to be read on something.
  return [...counted].sort((one, other) => other[1] - one[1])[0]?.[0] ?? 'level'
}

/** What a rung of the alert ladder is drawn as: a line at a value, coloured. */
export type Rung = { value: number; colour: string }

/**
 * A rung the source gave no colour to.
 *
 * Its own grey rather than the one the axes are drawn in: two fifths of the
 * parc's thresholds carry no colour, and a rung in the colour of the frame it
 * is read against is a rung nobody picks out. This one is the widget's.
 */
export const UNCOLOURED = '#94a3b8'

/**
 * The rungs drawn behind the curve: the alert thresholds of the quantity shown.
 *
 * A mark of a past flood is not one of them — it says what was reached once,
 * on another quantity more often than not — and neither is a drought scale,
 * which reads the other way round. Both would be read as thresholds the station
 * is being judged against at this instant.
 */
export function ladderOf(
  thresholds: readonly Threshold[],
  stationId: number,
  quantity: Quantity,
): Rung[] {
  return (
    thresholds
      .filter(
        (one) =>
          one.stationId === stationId && one.nature === 'alert-level' && one.quantity === quantity,
      )
      .map((one) => ({ value: one.value, colour: one.color ?? UNCOLOURED }))
      // The order the replay froze them in says nothing, and the worker's own
      // `ladders()` is sorted: one word, one meaning, across the two packages.
      .sort((one, other) => one.value - other.value)
  )
}

/**
 * How many marks of past floods the station carries, which the curve never draws.
 *
 * Counted so the bubble can say the station carries them: a mark is a height
 * that was reached once, and the bubble would otherwise show a scale of alert
 * thresholds as everything the station is known by. Every quantity of the
 * station, since what is said is what the station carries and not what this
 * curve could have drawn.
 */
export function floodMarksOf(thresholds: readonly Threshold[], stationId: number): number {
  return thresholds.filter((one) => one.stationId === stationId && one.nature === 'flood-mark')
    .length
}

/** The measures of one source and one quantity, oldest first, read once. */
export function seriesOf(
  measures: readonly Measure[],
  sourceId: number,
  quantity: Quantity,
): Series {
  // On the quantity as much as on the source: a station measured on two of them
  // would otherwise draw its levels on an axis of flows. The family is not part
  // of it — the rain gauges measure rainfall alone, so no homonym of a station
  // can answer to a level or a flow.
  const points = measures
    .filter((one) => one.sourceId === sourceId && one.quantity === quantity)
    .map((one) => ({ at: Date.parse(one.at), value: one.value }))
    .sort((one, other) => one.at - other.at)

  return { quantity, unit: UNITS[quantity], points }
}

/** What the station last measured before the instant being read. */
export function valueAt(points: readonly Reading[], at: Cursor): Reading | undefined {
  return lastBefore(points, at)
}
