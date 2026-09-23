import proj4 from 'proj4'

import type { Position } from './contracts/geometry.ts'

/**
 * Sandre projection codes Aquasys carries, and their EPSG match.
 *
 * The `projection` / `projectionType` fields hold a Sandre code, not an EPSG
 * one, and the fleet is not homogeneous: all 94 hydrological stations are in
 * Lambert 93, while 222 of the 229 rain gauges are already in degrees and only
 * 6 are in Lambert 93. Reprojecting a rain gauge that is already in WGS84 drops
 * it in the Atlantic.
 *
 * Code 26 was confirmed to be EPSG:2154 by applying the inverse Lambert 93 and
 * checking the stations land on the communes their names announce — Matemale,
 * Axat, Salses-le-Château.
 */
export const SANDRE_LAMBERT_93 = 26
export const SANDRE_WGS84 = 16

const LAMBERT_93 =
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=44 +lat_2=49 +x_0=700000 +y_0=6600000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs'

function lambert93ToWgs84(x: number, y: number): Position {
  const projected = proj4(LAMBERT_93, WGS84, { x, y })
  return { lon: round(projected.x), lat: round(projected.y) }
}

/**
 * Brings Aquasys coordinates onto WGS84, refusing any code we have not verified.
 *
 * A wrong projection selects the wrong sources for an extent and nothing on
 * screen signals it, so an unknown code is a failure for that source rather
 * than a guess.
 */
export function sandreToWgs84(x: number, y: number, sandreCode: number): Position {
  switch (sandreCode) {
    case SANDRE_LAMBERT_93:
      return lambert93ToWgs84(x, y)
    case SANDRE_WGS84:
      // A source that declares degrees and holds metres would land in the
      // Atlantic with nothing on screen to say so.
      if (Math.abs(x) > 180 || Math.abs(y) > 90) {
        throw new RangeError(
          `Source declares Sandre ${SANDRE_WGS84} (WGS84) but holds ${x}, ${y}, which is not degrees`,
        )
      }
      return { lon: round(x), lat: round(y) }
    default:
      throw new RangeError(
        `Unknown Sandre projection code ${sandreCode}; only ` +
          `${SANDRE_LAMBERT_93} (EPSG:2154) and ${SANDRE_WGS84} (WGS84) are established`,
      )
  }
}

/** Six decimals is roughly 0.1 m, far below the precision of a station position. */
function round(degrees: number): number {
  return Math.round(degrees * 1e6) / 1e6
}
