import type { RainGauge, Station } from '@smmarchives/shared/contracts/station.ts'
import type { Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import type { Views } from './pictures.ts'
import type { Gauges } from './rain.ts'

/**
 * What the switch is called, in the one place that spells it: the lanes point
 * back at it from the other end of the screen.
 */
export const MUTES = 'Sources sans données'

/**
 * The gauges a replay holds no rain of over its period, for the map to hold back.
 *
 * **A data set nobody collected names nobody.** A gauge missing from collected
 * rain measured nothing; a failed collection knows nothing of any gauge, and
 * arrives here as `undefined`, never as an empty map.
 */
export function gaugesWithoutRain(
  gauges: readonly RainGauge[],
  rain: Gauges | undefined,
): Set<number> {
  if (rain === undefined) return new Set()

  return new Set(gauges.filter((one) => !rain.has(one.id)).map((one) => one.id))
}

/**
 * The stations a replay holds no measure of over its period, read off the list
 * of the measured ones: their measures are not loaded. Nobody when the replay
 * holds no such list, for the reason the gauges give.
 */
export function stationsWithoutMeasures(
  stations: readonly Station[],
  measured: ReadonlySet<number> | undefined,
): Set<number> {
  if (measured === undefined) return new Set()

  return new Set(stations.filter((one) => !measured.has(one.id)).map((one) => one.id))
}

/**
 * The cameras no picture was frozen of, read from the views and not the paths,
 * so that the map and the strip agree. A replay holding no picture at all names
 * every one of its cameras.
 */
export function webcamsWithoutPicture(webcams: readonly Webcam[], views: Views): Set<string> {
  return new Set(webcams.filter((one) => !views.has(one.code)).map((one) => one.code))
}
