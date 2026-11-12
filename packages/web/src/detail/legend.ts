import { ASSUMED_NATURE } from '../tracks/crossing.ts'
import { formatValue, type Rung } from './series.ts'

/** One line of a chart's legend of thresholds. */
export type LegendLine = { colour: string; said: string; why: string | undefined }

/**
 * The thresholds a chart rules, named: the highest first, as the chart reads
 * from the top, each with its value in the unit the curve is shown in.
 */
export function legendOf(ladder: readonly Rung[], unit: string): LegendLine[] {
  return ladder
    .toSorted((one, other) => other.value - one.value)
    .map((one) => ({
      colour: one.colour,
      said: `${one.label} — ${formatValue(one.value)} ${unit}${one.assumed ? ' (type déduit)' : ''}`,
      why: one.assumed ? ASSUMED_NATURE : undefined,
    }))
}
