import type { Feature, FeatureCollection, Geometry, Point } from 'geojson'

import type { Position } from '@smmarchives/shared/contracts/geometry.ts'
import type { StationCategory } from '@smmarchives/shared/contracts/station.ts'

import { gaugesWithoutRain } from '../mutes.ts'
import type { ReplayContent } from '../tracks/lanes.ts'

/** The three symbols the map draws, and the only three. */
export const KINDS = ['watercourse', 'structure', 'rain-gauge'] as const

export type Kind = (typeof KINDS)[number]

/** A source of the replay, placed or not. */
type Source = {
  key: string
  kind: Kind
  id: number
  name: string
  position: Position | null
  /** The replay holds nothing of it over the period. See `mutes.ts`. */
  mute: boolean
}

export type SourcesOnTheMap = {
  geojson: FeatureCollection<Point>
  /** Sources the replay holds without a position, which the map cannot draw. */
  placeless: number
}

export function sourcesOf(content: ReplayContent): SourcesOnTheMap {
  const features: Feature<Point>[] = []
  let placeless = 0

  for (const one of everySource(content)) {
    if (one.position === null) placeless += 1
    else {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [one.position.lon, one.position.lat] },
        properties: {
          key: one.key,
          kind: one.kind,
          id: one.id,
          name: one.name,
          mute: one.mute,
        },
      })
    }
  }

  return { geojson: { type: 'FeatureCollection', features }, placeless }
}

/**
 * How many sources the replay holds that the map cannot draw.
 *
 * Counted over the sources themselves rather than over what `sourcesOf` builds:
 * a reader of this number does not need the three hundred features that go with
 * it, and building them to read one integer is three hundred objects thrown
 * away.
 */
export function placelessOf(content: ReplayContent): number {
  return everySource(content).filter((one) => one.position === null).length
}

/** The extent of what is drawn, for the map to open on the replay it shows. */
export function boundsOf(content: ReplayContent): [[number, number], [number, number]] | undefined {
  const points = everySource(content)
    .map((one) => one.position)
    .filter((one): one is Position => one !== null)
  if (points.length === 0) return undefined

  const lons = points.map((one) => one.lon)
  const lats = points.map((one) => one.lat)
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}

/**
 * Both Aquasys families in one list, each source carrying its family in its key.
 *
 * `watercourse:4` and `rain-gauge:4` are two different sources: the two
 * families number theirs independently, and 58 rain gauges of the parc carry a
 * station's identifier. Nothing downstream may address a source by that
 * identifier alone — which is why a key, and not an identifier, is what a
 * colour is handed out against.
 */
function everySource(content: ReplayContent): Source[] {
  // No station is ever mute: `mutes.ts` says why, and the layer panel says it
  // to the reader rather than letting the switch promise what it cannot do.
  const mute = gaugesWithoutRain(content.rainGauges, content.rain)

  return [
    ...content.stations.map((one) => sourceOf(kindOf(one.category), one, false)),
    ...content.rainGauges.map((one) => sourceOf('rain-gauge', one, mute.has(one.id))),
  ]
}

function sourceOf(
  kind: Kind,
  one: { id: number; name: string; position: Position | null },
  mute: boolean,
): Source {
  return {
    key: keyOf(kind, one.id),
    kind,
    id: one.id,
    name: one.name,
    position: one.position,
    mute,
  }
}

/**
 * How a source is named once it has left the list it came from.
 *
 * The one place the shape is spelled: everything that hands out a colour, reads
 * one back, or looks a drawn feature up goes through here, so the rule that a
 * key carries its family cannot be forgotten in one of them.
 */
export function keyOf(kind: Kind, id: number): string {
  return `${prefixOf(kind)}${String(id)}`
}

/** What every key of a family begins with, and how one is told from another. */
export function prefixOf(kind: Kind): string {
  return `${kind}:`
}

export function kindOf(category: StationCategory): Kind {
  return category === 'structure' ? 'structure' : 'watercourse'
}

/** A source as the map drew it: what it is, and the point it was drawn at. */
export type DrawnSource = { kind: Kind; id: number; name: string; at: [number, number] }

type DrawnFeature = { properties: Record<string, unknown> | null; geometry: Geometry }

/**
 * Which of the sources under a pointer the reader meant.
 *
 * A station before a rain gauge, wherever the two stand on the same spot: the
 * station is the one carrying a threshold, and the parc holds two hundred and
 * twenty-nine gauges over ninety-four stations, so the collision is ordinary.
 *
 * Read here because it is written here: the properties a drawn feature carries
 * are the ones `sourcesOf` put on it, and a second place reading them would
 * drift from this one.
 */
export function sourceUnder(features: readonly DrawnFeature[]): DrawnSource | undefined {
  const sources = features.map(drawnSourceOf).filter((one) => one !== undefined)
  return sources.find((one) => one.kind !== 'rain-gauge') ?? sources[0]
}

function drawnSourceOf(feature: DrawnFeature): DrawnSource | undefined {
  const { kind, id, name } = feature.properties ?? {}
  if (feature.geometry.type !== 'Point') return undefined
  if (!isKind(kind) || typeof id !== 'number' || typeof name !== 'string') return undefined

  const [lon, lat] = feature.geometry.coordinates
  return lon === undefined || lat === undefined ? undefined : { kind, id, name, at: [lon, lat] }
}

export function isKind(one: unknown): one is Kind {
  return KINDS.includes(one as Kind)
}
