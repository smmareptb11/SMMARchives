import type { BoundingBox } from '../contracts/geometry.ts'
import { BASIN_BOUNDS } from './perimeters.ts'

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
  minLon: BASIN_BOUNDS.minLon - FLEET_MARGIN,
  minLat: BASIN_BOUNDS.minLat - FLEET_MARGIN,
  maxLon: BASIN_BOUNDS.maxLon + FLEET_MARGIN,
  maxLat: BASIN_BOUNDS.maxLat + FLEET_MARGIN,
}
