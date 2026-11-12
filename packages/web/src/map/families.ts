import { reportsOf } from '../events/reports.ts'
import { MUTED, REPORT } from '../palette.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { KINDS, kindOf } from './sources.ts'
import { NEUTRAL } from './state.ts'

/**
 * The families a reader can cut off: what agents reported, the three sources
 * drawn, and the two others.
 */
export const FAMILIES = ['report', ...KINDS, 'webcam', 'territory'] as const

export type Family = (typeof FAMILIES)[number]

/** Which families are drawn. */
export type Shown = Record<Family, boolean>

/**
 * What each family is called, in the one place the map names them.
 *
 * Both numbers: the legend names a family, a bubble names one source of it, and
 * the two sitting on the same map must not name the same shape differently. The
 * lanes below keep their own names, for a fourth family the map folds away.
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
 * What a family's mark is drawn in, beside its name in the panel.
 *
 * The map's neutral for the two hydro families, which is what a station under
 * every threshold shows. A rain gauge takes the panel's own grey instead: no
 * gauge is drawn in that neutral, and it falls between two classes of the ramp
 * under the row, so the shape would read as a quantity.
 */
export function swatchColourOf(family: Family): string {
  if (family === 'report') return REPORT
  return family === 'rain-gauge' ? MUTED : NEUTRAL
}

/**
 * The families this replay holds, and no others, with the territory the
 * application carries for every replay.
 *
 * A switch for a family the replay does not hold answers nothing when it is
 * cut: no layer to hide, no marker to take off. A switch that does nothing
 * tells a reader less than no switch at all.
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
