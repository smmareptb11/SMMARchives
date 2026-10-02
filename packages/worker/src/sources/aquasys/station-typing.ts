import type { Fallback, StationCategory } from '@smmarchives/shared'

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

export type StationTyping = {
  /** The category of each typed station; a station absent from it is untyped. */
  categories: ReadonlyMap<number, StationCategory>
  fallbacks: Fallback[]
}

/**
 * Types the fleet from its network links.
 *
 * A station its networks type both ways is left untyped rather than given
 * either category: a wrong symbol on the map looks plausible, a missing
 * station does not, and the report names it for correction in Aquasys.
 */
export function typeStations(links: readonly RawNetworkLink[]): StationTyping {
  const candidates = new Map<number, Set<StationCategory>>()
  for (const link of links) {
    const category = NETWORK_CATEGORIES.get(link.idNetwork)
    if (category === undefined) continue
    const found = candidates.get(link.idStation) ?? new Set()
    candidates.set(link.idStation, found.add(category))
  }

  const categories = new Map<number, StationCategory>()
  const fallbacks: Fallback[] = []
  const byStation = [...candidates].sort(([one], [other]) => one - other)
  for (const [idStation, found] of byStation) {
    if (found.size === 1) {
      categories.set(idStation, [...found][0]!)
    } else {
      fallbacks.push({
        subject: `station ${idStation}`,
        rule: 'on both structure and watercourse networks',
        applied: 'station dropped',
      })
    }
  }

  return { categories, fallbacks }
}
