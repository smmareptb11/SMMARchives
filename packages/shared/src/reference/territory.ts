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
 * How far past the perimeters the fleet reaches, in degrees: rain gauges watch
 * the slopes that drain into the basin from outside it, the farthest a tenth of
 * a degree east.
 */
const FLEET_MARGIN = 0.15

/**
 * The only ground a replay covers: the perimeters and the fleet around them.
 * Frozen rather than fetched, so refusing an extent depends on no service.
 */
export const SMMAR_TERRITORY: BoundingBox = {
  minLon: PERIMETERS.minLon - FLEET_MARGIN,
  minLat: PERIMETERS.minLat - FLEET_MARGIN,
  maxLon: PERIMETERS.maxLon + FLEET_MARGIN,
  maxLat: PERIMETERS.maxLat + FLEET_MARGIN,
}
