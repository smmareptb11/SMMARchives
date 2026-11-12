import type { StationCategory } from '../contracts/station.ts'

/**
 * The rules that sort what Aquasys does not sort itself, frozen here.
 *
 * Neither the networks a station belongs to nor the label of a threshold is a
 * classification the source states: these tables are this application's
 * reading of them. A build copies them into the report of what they sorted, so
 * a replay says which reading it was made with.
 */

/**
 * The networks that type a station, by the code a link's `idNetwork` refers to.
 *
 * A station belonging to none of them bears on no flood, and a replay never
 * holds it. The other networks a station may also belong to change nothing.
 */
export const NETWORK_CATEGORIES: ReadonlyMap<number, StationCategory> = new Map([
  [1, 'watercourse'], // Étiage
  [2, 'watercourse'], // Inondation
  [4, 'structure'], // Ouvrage
  [5, 'structure'], // Déversoir
])

/**
 * A label naming a past flood, wherever it stands in it: station 22 wraps each
 * of its marks as « Autre (Crue du 15/10/2018) ».
 */
export const FLOOD_MARK_LABEL = /\bcrue\s+du\b/i

/** The regulatory ladder's ranks, « alerte renforcée » tested before the « alerte » it contains. */
export const GRAVITY_LABELS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bcrise\b/i, 4],
  [/\balerte\s+renforc/i, 3],
  [/\balerte\b/i, 2],
  [/\bvigilance\b/i, 1],
]

/** The station typing as a report carries it. */
export function networkRules(): { network: number; category: StationCategory }[] {
  return [...NETWORK_CATEGORIES].map(([network, category]) => ({ network, category }))
}

/** The threshold labels' reading as a report carries it: patterns, read regardless of case. */
export function thresholdLabelRules(): {
  floodMark: string
  gravity: { pattern: string; rank: number }[]
} {
  return {
    floodMark: FLOOD_MARK_LABEL.source,
    gravity: GRAVITY_LABELS.map(([pattern, rank]) => ({ pattern: pattern.source, rank })),
  }
}
