import type { StationCategory } from '@smmarchives/shared'

import type { RawNetworkLink } from './raw.ts'

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

/** The category of each typed station; a station absent from it is untyped. */
export function typeStations(
  links: readonly RawNetworkLink[],
): ReadonlyMap<number, StationCategory> {
  const categories = new Map<number, StationCategory>()
  for (const link of links) {
    const category = NETWORK_CATEGORIES.get(link.idNetwork)
    if (category !== undefined) categories.set(link.idStation, category)
  }
  return categories
}
