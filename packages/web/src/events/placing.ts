import {
  crossesItself,
  enclosesSomething,
  type EventPosition,
} from '@smmarchives/shared/contracts/event.ts'
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

const OUTSIDE = 'Ce lieu tombe hors de l’emprise du rejeu.'

/** A diamond where the agent clicked, if the replay covers that spot. */
export function pointAt(spot: Spot, extent: BoundingBox): Placed {
  return inside(spot, extent)
    ? { position: { type: 'Point', coordinates: spot } }
    : { refusal: OUTSIDE }
}

/**
 * The area the vertices outline, closed on its first one.
 *
 * Judged by the contract's own rules, so the form refuses what the API would:
 * an area that encloses something and does not cross itself. Every vertex
 * within the extent is then enough — an extent is a rectangle, so it holds
 * whatever its vertices outline.
 */
export function areaOf(vertices: readonly Spot[], extent: BoundingBox): Placed {
  const first = vertices[0]
  const ring = first === undefined ? [...vertices] : [...vertices, first]
  // The crossing first: a symmetrical bow tie also has no area, and saying it
  // crosses tells the agent what to change.
  if (crossesItself(ring)) return { refusal: 'Les côtés de la zone ne doivent pas se croiser.' }
  if (!enclosesSomething(ring)) {
    return { refusal: 'Une zone a trois sommets au moins, qui ne sont pas alignés.' }
  }
  if (!vertices.every((one) => inside(one, extent))) return { refusal: OUTSIDE }

  return { position: { type: 'Polygon', coordinates: [ring] } }
}

function inside([lon, lat]: Spot, extent: BoundingBox): boolean {
  return contains(extent, { lon, lat })
}

/**
 * What the small map draws: the extent, the place chosen, and the area being
 * traced, each tagged with what it is so one layer per kind can pick it out.
 */
export function drawingOf(
  extent: BoundingBox,
  position: EventPosition | null,
  tracing: readonly Spot[],
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
  if (tracing.length > 1) {
    features.push({
      type: 'Feature',
      properties: { part: 'tracing' },
      geometry: { type: 'LineString', coordinates: [...tracing] },
    })
  }
  for (const vertex of tracing) {
    features.push({
      type: 'Feature',
      properties: { part: 'vertex' },
      geometry: { type: 'Point', coordinates: vertex },
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
