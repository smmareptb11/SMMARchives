import type { RainGauge } from '@smmarchives/shared/contracts/station.ts'
import type { Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import type { Views } from './pictures.ts'
import type { Gauges } from './rain.ts'

/**
 * What the switch is called, in the one place that spells it.
 *
 * The panel writes it on the switch and the lanes point back at it from the
 * other end of the screen; spelled twice, one of them would soon send a reader
 * looking for something that is no longer there.
 */
export const MUTES = 'Sources sans données sur la période'

/**
 * The gauges a replay holds no rain of over its period, for the map to hold back.
 *
 * A replay keeps them — an absence has to stay explainable, and the manifest
 * counts them as the gap between `fleet.inExtent` and `fleet.withMeasures`. On
 * the map they are two hundred and twenty-nine grey triangles over the
 * ninety-four stations a reader came for.
 *
 * **A data set nobody collected names nobody.** A gauge missing from a rain the
 * replay collected measured nothing; a parc whose collection failed is a replay
 * that knows nothing of any of them, and hiding all of them would blame two
 * hundred and twenty-nine gauges for one lane's failure. Only the manifest tells
 * the two apart, and `ReplayContent` is where it was asked — which is why the
 * rain arrives here as `undefined` rather than as an empty map.
 *
 * No station is ever named, here or anywhere: their measures are the nineteen
 * megabytes `ReplayScreen` deliberately does not load, and the panel says so
 * beside the switch rather than promising otherwise.
 */
export function gaugesWithoutRain(
  gauges: readonly RainGauge[],
  rain: Gauges | undefined,
): Set<number> {
  if (rain === undefined) return new Set()

  return new Set(gauges.filter((one) => !rain.has(one.id)).map((one) => one.id))
}

/**
 * The cameras no picture was frozen of, read from the views and not the paths.
 *
 * `pictures.ts` is what decides which views a replay holds — it leaves out the
 * ones whose two downloads both failed — and a second reading of the paths here
 * would let the map draw a camera the strip has nothing to show for.
 *
 * A replay holding no picture at all names every one of its cameras. Their lanes
 * are held back and counted whatever this answers, so a map that went on drawing
 * them made the switch say a number it did not do.
 */
export function webcamsWithoutPicture(webcams: readonly Webcam[], views: Views): Set<string> {
  return new Set(webcams.filter((one) => !views.has(one.code)).map((one) => one.code))
}
