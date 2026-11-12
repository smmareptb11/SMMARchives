import type { Measure } from '@smmarchives/shared/contracts/measure.ts'
import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'
import { UNITS } from '@smmarchives/shared'
import type { LevelDatum } from '@smmarchives/shared/contracts/station.ts'
import type { Threshold, ThresholdNature } from '@smmarchives/shared/contracts/threshold.ts'

import { lastBefore, type Cursor } from '../transport/reading.ts'
import type { Pill } from './pills.ts'

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
 * Its alert ladder says it, and failing one its drought ladder: a mark of a
 * past flood says what was reached once, never what is being watched. The
 * alert ladder comes first, being the one the curve draws and the replay
 * crosses; a drought scale reads the other way round, but still names the
 * quantity the station is judged on.
 *
 * A ladder bearing on two quantities — the contract allows it, a threshold's
 * identifier being unique within a station *and* a quantity — is read on the
 * one carrying the most thresholds. The richest ladder is the one the station
 * is really judged against, and the order the replay froze them in decides
 * nothing.
 */
export function watchedQuantity(thresholds: readonly Threshold[], stationId: number): Quantity {
  return (
    richestQuantity(thresholds, stationId, 'alert-level') ??
    richestQuantity(thresholds, stationId, 'drought-threshold') ??
    // Part of the fleet carries no ladder at all, and a station has to be read on something.
    'level'
  )
}

/** The quantities a station's chart switches between. */
export const QUANTITIES: readonly Pill<Quantity>[] = [
  { label: 'Hauteur', value: 'level' },
  { label: 'Débit', value: 'flow' },
]

/** How the interface names a quantity when it says it has none of it. */
export const NAMED: Record<Quantity, string> = {
  level: 'hauteur',
  flow: 'débit',
  rainfall: 'pluie',
}

/**
 * The quantities a station's chart switches between, those it measured none
 * of over the period greyed out.
 *
 * Only those known to be empty: a quantity still being read, or failing to be,
 * has no series yet and stays offered, and the chart says what became of it.
 */
export function quantitiesFor(
  read: Partial<Record<Quantity, Series | undefined>>,
): Pill<Quantity>[] {
  return QUANTITIES.map((one) =>
    read[one.value]?.points.length === 0
      ? { ...one, unavailable: `Aucune mesure de ${NAMED[one.value]} dans la période` }
      : one,
  )
}

/**
 * The quantity a station's chart opens on: the one it is watched on, which the
 * map and the lanes show too.
 *
 * Unless the chart offers no way back to it. A ladder on rainfall is one the
 * contract allows, and a chart opened on it would show no choice picked, and
 * lose it at the first click: the level is then where it opens, which is what a
 * station without any ladder is read on.
 */
export function openedQuantity(thresholds: readonly Threshold[], stationId: number): Quantity {
  const watched = watchedQuantity(thresholds, stationId)

  return QUANTITIES.some((one) => one.value === watched) ? watched : 'level'
}

/** The unit of a level read from each datum, as the Acycliq widget names it. */
const LEVEL_UNIT: Record<LevelDatum, string> = { gauge: 'm', ngf: 'm NGF' }

/** The two ways a level reads. */
export const LEVEL_DATUMS: readonly Pill<LevelDatum>[] = [
  { label: LEVEL_UNIT.gauge, value: 'gauge' },
  { label: LEVEL_UNIT.ngf, value: 'ngf' },
]

/** The datum a level is shown from, and how far its values move to get there. */
export type LevelView = { datum: LevelDatum; shift: number }

/**
 * The datum picked, reached from the one the source measures the station from
 * by the NGF altitude of its gauge zero, one way or the other.
 *
 * Without that altitude no level can be moved: it is shown from the datum it
 * was measured from, whichever was picked.
 */
export function levelView(
  measuredFrom: LevelDatum,
  picked: LevelDatum,
  ngfDatum: number | null,
): LevelView {
  if (ngfDatum === null || picked === measuredFrom) return { datum: measuredFrom, shift: 0 }

  return { datum: picked, shift: picked === 'ngf' ? ngfDatum : -ngfDatum }
}

/** To the millimetre, which is how the widget rounds a level in metres NGF. */
const shifted = (value: number, shift: number) => Math.round((value + shift) * 1000) / 1000

/** A level series as the view shows it: every measure moved, in the unit of its datum. */
export function levelSeriesIn(series: Series, view: LevelView): Series {
  return {
    ...series,
    unit: LEVEL_UNIT[view.datum],
    points: series.points.map((one) => ({ ...one, value: shifted(one.value, view.shift) })),
  }
}

/** The unit a quantity is shown in, from the datum picked for a level. */
export function unitIn(quantity: Quantity, view: LevelView | null): string {
  return view === null ? UNITS[quantity] : LEVEL_UNIT[view.datum]
}

/** A ladder moved as the series it is read against is. */
export function ladderIn(ladder: readonly Rung[], view: LevelView): Rung[] {
  return ladder.map((one) => ({ ...one, value: shifted(one.value, view.shift) }))
}

function richestQuantity(
  thresholds: readonly Threshold[],
  stationId: number,
  nature: ThresholdNature,
): Quantity | undefined {
  const counted = new Map<Quantity, number>()

  for (const one of thresholds) {
    if (one.stationId !== stationId || one.nature !== nature) continue
    counted.set(one.quantity, (counted.get(one.quantity) ?? 0) + 1)
  }

  return [...counted].sort((one, other) => other[1] - one[1])[0]?.[0]
}

/** What a rung of the alert ladder is drawn as: a line at a value, coloured. */
/** A threshold as the chart draws it and its legend names it. */
export type Rung = {
  value: number
  colour: string
  label: string
  /** Its type was deduced, the source not saying it. */
  assumed: boolean
}

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
      .map((one) => ({
        value: one.value,
        colour: one.color ?? UNCOLOURED,
        label: one.label,
        assumed: one.natureIsFallback,
      }))
      // The order the replay froze them in says nothing, and the worker's own
      // `ladders()` is sorted: one word, one meaning, across the two packages.
      .sort((one, other) => one.value - other.value)
  )
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
