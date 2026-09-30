import type { Fallback, StationCategory } from '@smmarchives/shared'

import type { RawNetwork, RawNetworkLink } from './raw.ts'

/**
 * The networks that type a station, as the SMMAR names them in Aquasys.
 *
 * A station belonging to none of them bears on no flood, and a replay never
 * holds it. The other networks a station may also belong to change nothing.
 */
export const NETWORK_CATEGORIES: ReadonlyMap<string, StationCategory> = new Map([
  ['Ouvrage', 'structure'],
  ['Déversoir', 'structure'],
  ['Inondation', 'watercourse'],
  ['Étiage', 'watercourse'],
])

export type StationTyping = {
  /** The category of each typed station; a station absent from it is untyped. */
  categories: ReadonlyMap<number, StationCategory>
  fallbacks: Fallback[]
}

/**
 * Types the fleet from its network links.
 *
 * Networks are matched by name, since their codes belong to the Aquasys
 * instance. A name the referential lacks types no station, which is reported:
 * a renamed network would otherwise drop every station it held.
 */
export function typeStations(
  links: readonly RawNetworkLink[],
  networks: readonly RawNetwork[],
): StationTyping {
  const byCode = new Map(networks.map((network) => [network.code, network.name]))
  const named = new Set(byCode.values())

  const categories = new Map<number, StationCategory>()
  for (const link of links) {
    const name = byCode.get(link.idNetwork)
    const category = name === undefined ? undefined : NETWORK_CATEGORIES.get(name)
    if (category !== undefined) categories.set(link.idStation, category)
  }

  const fallbacks = [...NETWORK_CATEGORIES.keys()]
    .filter((name) => !named.has(name))
    .map((name) => ({
      subject: `network ${name}`,
      rule: 'absent from the network referential',
      applied: 'no station typed by it',
    }))

  return { categories, fallbacks }
}
