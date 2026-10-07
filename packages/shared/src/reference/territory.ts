import type { BoundingBox } from '../contracts/geometry.ts'

/**
 * The rectangle around the perimeters of the SMMAR, read off the Lizmap layers
 * `perimetre_smmar` and `perimetre_syndicats`, which share it.
 */
const PERIMETERS: BoundingBox = {
  minLon: 1.797680218,
  minLat: 42.533555008,
  maxLon: 3.251962328,
  maxLat: 43.472207966,
}

/**
 * How far past the perimeters the fleet reaches, in degrees.
 *
 * Rain gauges watch the slopes that drain into the basin from outside it, the
 * farthest — Béziers-Vias — a tenth of a degree east of the perimeters. The
 * margin keeps each of them within an extent's reach.
 */
const FLEET_MARGIN = 0.15

/**
 * The only ground a replay covers: the perimeters and the fleet around them.
 *
 * Frozen rather than fetched: an extent is checked before any build runs, and
 * a replay must not depend on a production service to be refused.
 */
export const SMMAR_TERRITORY: BoundingBox = {
  minLon: PERIMETERS.minLon - FLEET_MARGIN,
  minLat: PERIMETERS.minLat - FLEET_MARGIN,
  maxLon: PERIMETERS.maxLon + FLEET_MARGIN,
  maxLat: PERIMETERS.maxLat + FLEET_MARGIN,
}
