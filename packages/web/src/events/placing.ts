import type { EventPosition } from '@smmarchives/shared/contracts/event.ts'
import { contains, type BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'
import { SMMAR_TERRITORY } from '@smmarchives/shared/reference/territory.ts'
import type { Feature, FeatureCollection } from 'geojson'

/** A spot on the map, as MapLibre hands a click over. */
export type Spot = [number, number]

/** Where an event may be placed: the replay's extent, or the territory when it has none. */
export function extentOf(manifest: Pick<ReplayManifest, 'extent'>): BoundingBox {
  return manifest.extent ?? SMMAR_TERRITORY
}

export type Placed = { position: EventPosition } | { refusal: string }

/** How the agent places an event: on a spot, or as an area spanned by two corners. */
export type Mode = 'point' | 'area'

/**
 * What the form asks of the replay's map while it is open: what to draw, and —
 * while the agent places the event — where a click on the map goes.
 *
 * The form keeps the decision, the map only shows and listens: what a click
 * makes of a spot is `pointAt`'s and `rectangleOf`'s, wherever the click landed.
 */
export type Placement = {
  drawing: FeatureCollection
  listening: Listening | undefined
  /** The event the form amends, which the map leaves out so it shows one place for it. */
  amending: string | undefined
}

/** The agent placing the event: each click a spot, until the place is set or given up. */
export type Listening = {
  mode: Mode
  /** The first corner of an area, once clicked: the map follows the pointer from it. */
  anchor: Spot | undefined
  onSpot: (spot: Spot) => void
  onCancel: () => void
}

const OUTSIDE = 'Ce lieu tombe hors de l’emprise du rejeu.'

/** A diamond where the agent clicked, if the replay covers that spot. */
export function pointAt(spot: Spot, extent: BoundingBox): Placed {
  return inside(spot, extent)
    ? { position: { type: 'Point', coordinates: spot } }
    : { refusal: OUTSIDE }
}

/**
 * The rectangle two opposite corners span, as the ring GeoJSON wants: closed
 * on its first corner, counter-clockwise.
 */
export function rectangleRing([lon, lat]: Spot, [otherLon, otherLat]: Spot): Spot[] {
  const [west, east] = [Math.min(lon, otherLon), Math.max(lon, otherLon)]
  const [south, north] = [Math.min(lat, otherLat), Math.max(lat, otherLat)]
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
}

/**
 * The area two opposite corners span, if the replay covers it.
 *
 * Two clicks place it, as one places a spot, and it can neither cross itself
 * nor enclose nothing once it has a width and a height. Both corners within the
 * extent is enough — an extent is a rectangle, so it holds whatever they span.
 */
export function rectangleOf(corner: Spot, opposite: Spot, extent: BoundingBox): Placed {
  if (corner[0] === opposite[0] || corner[1] === opposite[1]) {
    return { refusal: 'Une zone a une largeur et une hauteur : cliquez le coin opposé.' }
  }
  if (!inside(corner, extent) || !inside(opposite, extent)) return { refusal: OUTSIDE }

  return { position: { type: 'Polygon', coordinates: [rectangleRing(corner, opposite)] } }
}

function inside([lon, lat]: Spot, extent: BoundingBox): boolean {
  return contains(extent, { lon, lat })
}

/**
 * What the map draws for the form: the extent, the place chosen, and the first
 * corner of an area, each tagged with what it is so one layer per kind can pick
 * it out.
 */
export function drawingOf(
  extent: BoundingBox,
  position: EventPosition | null,
  anchor: Spot | undefined,
): FeatureCollection {
  const features: Feature[] = [
    {
      type: 'Feature',
      properties: { part: 'extent' },
      geometry: { type: 'Polygon', coordinates: [cornersOf(extent)] },
    },
  ]
  if (position !== null)
    features.push({ type: 'Feature', properties: { part: 'placed' }, geometry: position })
  if (anchor !== undefined) {
    features.push({
      type: 'Feature',
      properties: { part: 'vertex' },
      geometry: { type: 'Point', coordinates: anchor },
    })
  }
  return { type: 'FeatureCollection', features }
}

function cornersOf(extent: BoundingBox): Spot[] {
  const { minLon, minLat, maxLon, maxLat } = extent
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ]
}
