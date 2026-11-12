import type { Feature, FeatureCollection, Geometry, Point } from 'geojson'

import type { Position } from '@smmarchives/shared/contracts/geometry.ts'
import type { Station, StationCategory } from '@smmarchives/shared/contracts/station.ts'

import { gaugesWithoutRain, stationsWithoutMeasures } from '../mutes.ts'
import { clearOf, type Padding, type Rect } from './framing.ts'
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

/** Room left around the sources on opening: the legend's width on the right. */
const FRAMED = { top: 40, right: 280, bottom: 40, left: 40 }

/**
 * The room left around the sources, for a map of this size.
 *
 * The full room while it leaves the sources at least half the map, less in
 * proportion otherwise: on a small window, room the map does not have makes
 * MapLibre give up, and the replay would open on the basin rather than on what
 * it holds.
 */
export function framedIn(width: number, height: number): typeof FRAMED {
  const across = Math.min(1, width / 2 / (FRAMED.left + FRAMED.right))
  const down = Math.min(1, height / 2 / (FRAMED.top + FRAMED.bottom))

  return {
    top: FRAMED.top * down,
    right: FRAMED.right * across,
    bottom: FRAMED.bottom * down,
    left: FRAMED.left * across,
  }
}

type Bounds = [[number, number], [number, number]]

/**
 * Where the map opens, and the room left around it: as close as it can while
 * showing every source, and none of them under the legend.
 *
 * On a phone, on the stations and the structures, which are what a replay is
 * about: the rain gauges reach well past the basin, and framed with them the
 * basin is a third of a small screen. On all of its sources when it holds no
 * station.
 */
export function openingOf(
  content: ReplayContent,
  size: { width: number; height: number },
  phone: boolean,
  legend?: Rect,
): { bounds: Bounds; padding: Padding } | undefined {
  const stations = phone ? pointsOf(content, (one) => one.kind !== 'rain-gauge') : []
  const points = stations.length > 0 ? stations : pointsOf(content)
  const bounds = boundsAround(points)
  return bounds === undefined ? undefined : { bounds, padding: clearOf(points, size, legend) }
}

/**
 * Whether a view holds every source the map opened on, which is when there is
 * no overview to go back to.
 */
export function seesAll(
  view: { west: number; south: number; east: number; north: number },
  bounds: Bounds,
): boolean {
  const [[west, south], [east, north]] = bounds
  return view.west <= west && view.south <= south && view.east >= east && view.north >= north
}

/** The extent of what is drawn, or of the sources asked, for the map to open on the replay it shows. */
export function boundsOf(
  content: ReplayContent,
  asked: (source: Source) => boolean = () => true,
): Bounds | undefined {
  return boundsAround(pointsOf(content, asked))
}

/** Where the sources asked stand, as longitude and latitude, the placeless left out. */
function pointsOf(
  content: ReplayContent,
  asked: (source: Source) => boolean = () => true,
): [number, number][] {
  return everySource(content)
    .filter(asked)
    .map((one) => one.position)
    .filter((one): one is Position => one !== null)
    .map((one) => [one.lon, one.lat])
}

function boundsAround(points: readonly [number, number][]): Bounds | undefined {
  if (points.length === 0) return undefined
  const lons = points.map(([lon]) => lon)
  const lats = points.map(([, lat]) => lat)
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
  // One set per family: a station and a rain gauge may share a number.
  const unmeasured = stationsWithoutMeasures(content.stations, content.measuredStations)
  const mute = gaugesWithoutRain(content.rainGauges, content.rain)

  return [
    ...content.stations.map((one) => sourceOf(kindOf(one.category), one, unmeasured.has(one.id))),
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

/**
 * A station, a structure or a rain gauge as the map draws it, from its family
 * and its number — what a lane names it by. Nothing for one the replay does not
 * hold, or holds with nowhere to draw it.
 */
export function namedSourceOf(
  content: ReplayContent,
  named: { source: Kind; id: number },
): DrawnSource | undefined {
  const one = everySource(content).find((it) => it.kind === named.source && it.id === named.id)
  if (one?.position == null) return undefined
  return { kind: one.kind, id: one.id, name: one.name, at: [one.position.lon, one.position.lat] }
}

/** A source as the map drew it: what it is, and the point it was drawn at. */
export type DrawnSource = { kind: Kind; id: number; name: string; at: [number, number] }

/** A station as the map draws it, or nothing for one it has nowhere to draw. */
export function drawnStation(station: Station): DrawnSource | undefined {
  const { position } = station
  if (position === null) return undefined
  return {
    kind: kindOf(station.category),
    id: station.id,
    name: station.name,
    at: [position.lon, position.lat],
  }
}

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
