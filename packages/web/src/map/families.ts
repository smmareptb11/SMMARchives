import type { ReferenceLayer } from '@smmarchives/shared/contracts/reference-layer.ts'

import { MUTED } from '../palette.ts'
import { radarStandingOf } from '../radar.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { KINDS, kindOf } from './sources.ts'
import { NEUTRAL } from './state.ts'

/** The families a reader can cut off: the three drawn, and the three others. */
export const FAMILIES = [...KINDS, 'webcam', 'territory', 'radar'] as const

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
  watercourse: { one: "Station cours d'eau", many: "Stations cours d'eau" },
  structure: { one: 'Ouvrage', many: 'Ouvrages' },
  'rain-gauge': { one: 'Pluviomètre', many: 'Pluviomètres' },
  webcam: { one: 'Webcam', many: 'Webcams' },
  territory: { one: 'Périmètre de syndicat', many: 'Périmètres des syndicats' },
  radar: { one: "Lame d'eau", many: "Lames d'eau" },
}

/**
 * What a family's mark is drawn in, beside its name in the panel.
 *
 * The map's neutral for the two hydro families, which is what a station under
 * every threshold shows. A rain gauge takes the panel's own grey instead: no
 * gauge shows that neutral any more, and it falls between two classes of the
 * ramp under the row, so the shape would read as a quantity.
 */
export function swatchColourOf(family: Family): string {
  return family === 'rain-gauge' ? MUTED : NEUTRAL
}

/** The layer of the Lizmap the map draws as the replay's ground. */
export const PERIMETERS = 'perimetre_syndicats'

/** The ground the replay copied, when it copied it. */
export function territoryOf(content: ReplayContent): ReferenceLayer | undefined {
  return content.layers.find((one) => one.name === PERIMETERS)
}

/**
 * The families this replay holds, and no others.
 *
 * A switch for a family the replay does not hold answers nothing when it is
 * cut: no layer to hide, no marker to take off. A switch that does nothing
 * tells a reader less than no switch at all.
 */
export function familiesOf(content: ReplayContent): Family[] {
  const drawn = new Set(content.stations.map((one) => kindOf(one.category)))

  return FAMILIES.filter((family) => {
    if (family === 'rain-gauge') return content.rainGauges.length > 0
    if (family === 'webcam') return content.webcams.length > 0
    if (family === 'territory') return territoryOf(content) !== undefined
    if (family === 'radar') return radarStandingOf(content) === 'drawable'
    return drawn.has(family)
  })
}

/**
 * What a reader opens on: everything drawn, but the rainfall.
 *
 * The extent those images are placed on is the one value the documentation flags as
 * unconfirmed, and a wrong one shifts the whole layer without anything on
 * screen saying so. Drawn on asking, rather than put in front of a reader who
 * did not — what the map says of it below the map says why.
 */
export const OPENING: Shown = {
  watercourse: true,
  structure: true,
  'rain-gauge': true,
  webcam: true,
  territory: true,
  radar: false,
}
