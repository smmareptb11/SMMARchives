import { z } from 'zod'

import {
  featureCollectionSchema,
  type BoundingBox,
  type Feature,
  type FeatureCollection,
} from '../contracts/geometry.ts'
// Frozen from the Lizmap layer `perimetre_syndicats` by a WFS `GetFeature`, each
// feature rewritten through PostGIS, keeping only `ref_smmar`, `nom` and
// `etiquette`, sorted by `ref_smmar`:
//
//     ST_AsGeoJSON(ST_SimplifyPreserveTopology(
//       ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326), 0.0005), 5)
import unions from './perimetre_syndicats.json' with { type: 'json' }

/**
 * The perimeter of one of the seven basin unions, carried by the application
 * rather than by each replay, and simplified to some fifty metres: its bounds
 * are an extent a user picks, not a measurement.
 *
 * Not exported from the package index, so the outlines stay in the map's chunk
 * instead of every page's.
 */
export type Perimeter = {
  /** `ref_smmar`, as the remote project spells it. */
  code: string
  /** `nom`, the body's full name. */
  name: string
  /** `etiquette`, the short name a list shows. */
  label: string
  outline: Feature
  bounds: BoundingBox
}

const propertiesSchema = z.object({
  ref_smmar: z.string(),
  nom: z.string(),
  etiquette: z.string(),
})

/**
 * The smallest rectangle holding every vertex of a GeoJSON geometry, whatever
 * its nesting; nothing for a geometry with no vertex.
 */
export function boundingBoxOf(geometry: unknown): BoundingBox | undefined {
  const coordinates =
    typeof geometry === 'object' && geometry !== null && 'coordinates' in geometry
      ? geometry.coordinates
      : []
  const vertices = verticesOf(coordinates)
  if (vertices.length === 0) return undefined

  const lons = vertices.map(([lon]) => lon)
  const lats = vertices.map(([, lat]) => lat)
  return {
    minLon: Math.min(...lons),
    minLat: Math.min(...lats),
    maxLon: Math.max(...lons),
    maxLat: Math.max(...lats),
  }
}

function verticesOf(coordinates: unknown): [number, number][] {
  if (!Array.isArray(coordinates)) return []
  const [lon, lat] = coordinates as unknown[]
  if (typeof lon === 'number' && typeof lat === 'number') return [[lon, lat]]
  return coordinates.flatMap(verticesOf)
}

function perimetersOf(collection: unknown): Perimeter[] {
  return featureCollectionSchema.parse(collection).features.map((outline) => {
    const properties = propertiesSchema.parse(outline.properties)
    const bounds = boundingBoxOf(outline.geometry)
    if (bounds === undefined) throw new Error(`perimeter ${properties.ref_smmar} has no outline`)
    return {
      code: properties.ref_smmar,
      name: properties.nom,
      label: properties.etiquette,
      outline,
      bounds,
    }
  })
}

/** The seven basin unions, by `ref_smmar`. */
export const UNIONS: readonly Perimeter[] = perimetersOf(unions)

/** Whether a replay's territory names one of the unions, by the short name a list shows. */
export function isUnion(territory: string): boolean {
  return UNIONS.some((one) => one.label === territory)
}

/**
 * The rectangle of the whole basin, which the seven unions cover together:
 * derived, since the Lizmap's own `perimetre_smmar` gives the same rectangle.
 */
export const BASIN_BOUNDS: BoundingBox = {
  minLon: Math.min(...UNIONS.map((one) => one.bounds.minLon)),
  minLat: Math.min(...UNIONS.map((one) => one.bounds.minLat)),
  maxLon: Math.max(...UNIONS.map((one) => one.bounds.maxLon)),
  maxLat: Math.max(...UNIONS.map((one) => one.bounds.maxLat)),
}

/** The outlines of the seven unions, which the map draws as the territory. */
export const UNION_OUTLINES: FeatureCollection = {
  type: 'FeatureCollection',
  features: UNIONS.map((one) => one.outline),
}
