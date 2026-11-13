import { reportsOf } from '../events/reports.ts'
import { MUTED, REPORT } from '../palette.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { KINDS, kindOf } from './sources.ts'
import { NEUTRAL } from './state.ts'

/**
 * The families a reader can cut off: what agents reported, the three sources
 * drawn, and the two others.
 */
const FAMILIES = ['report', ...KINDS, 'webcam', 'territory'] as const

export type Family = (typeof FAMILIES)[number]

/** Which families are drawn. */
export type Shown = Record<Family, boolean>

/**
 * What the map calls each family: one for a bubble, many for the legend, kept
 * together so that the two never name a shape differently. The lanes keep their
 * own names.
 */
export const NAMES: Record<Family, { one: string; many: string }> = {
  report: { one: 'Événement saisi', many: 'Événements saisis' },
  watercourse: { one: "Station cours d'eau", many: "Stations cours d'eau" },
  structure: { one: 'Ouvrage', many: 'Ouvrages' },
  'rain-gauge': { one: 'Pluviomètre', many: 'Pluviomètres' },
  webcam: { one: 'Webcam', many: 'Webcams' },
  territory: { one: 'Périmètre de syndicat', many: 'Périmètres des syndicats' },
}

/**
 * What a family's mark is drawn in, beside its name in the panel: the map's
 * neutral for the hydro families. A rain gauge takes the panel's grey, since that
 * neutral falls inside the ramp under the row and would read as a quantity.
 */
export function swatchColourOf(family: Family): string {
  if (family === 'report') return REPORT
  return family === 'rain-gauge' ? MUTED : NEUTRAL
}

/**
 * The families this replay holds, and no others, with the territory every replay
 * carries: a switch that cuts nothing tells a reader less than no switch.
 */
export function familiesOf(content: ReplayContent): Family[] {
  const drawn = new Set(content.stations.map((one) => kindOf(one.category)))

  return FAMILIES.filter((family) => {
    // Placed, or the map has nothing of it to cut: a report with no position is
    // on the lanes alone.
    if (family === 'report') return reportsOf(content.events).some((one) => one.position !== null)
    if (family === 'rain-gauge') return content.rainGauges.length > 0
    if (family === 'webcam') return content.webcams.length > 0
    if (family === 'territory') return true
    return drawn.has(family)
  })
}

/** Everything drawn, which is where a reader starts. */
export const EVERYTHING: Shown = {
  report: true,
  watercourse: true,
  structure: true,
  'rain-gauge': true,
  webcam: true,
  territory: true,
}
