import type { ReplayEvent, ThresholdCrossing } from '@smmarchives/shared/contracts/event.ts'
import type { Measure } from '@smmarchives/shared/contracts/measure.ts'
import type { RadarRainfallSeries } from '@smmarchives/shared/contracts/radar-rainfall.ts'
import type { RainGauge, Station } from '@smmarchives/shared/contracts/station.ts'
import type { Threshold } from '@smmarchives/shared/contracts/threshold.ts'
import type { FrozenWebcamImage, Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { speaking, type Family, type ReplayContent } from '../../src/tracks/lanes.ts'

export const period = { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' }

/** An instant as the cursor holds it, which is a number and not a string. */
export const at = (iso: string) => Date.parse(iso)

/**
 * A replay holding only what a test names.
 *
 * Shared rather than written once per suite: a field added to `ReplayContent`
 * would otherwise be added to every copy, and a copy that drifted would test a
 * content no screen ever sees.
 */
export function held(content: Partial<ReplayContent> = {}): ReplayContent {
  return {
    period,
    stations: [],
    rainGauges: [],
    events: [],
    thresholds: [],
    rain: undefined,
    webcams: [],
    images: [],
    series: [],
    ...content,
  }
}

export function aStation(
  id: number,
  name: string,
  category: Station['category'] = 'watercourse',
  position: Station['position'] = { lon: 2.4, lat: 43.2 },
): Station {
  return {
    id,
    code: null,
    name,
    comment: null,
    townCode: null,
    altitude: null,
    position,
    category,
    quantities: null,
  }
}

export function aGauge(
  id: number,
  name: string,
  lon: number,
  position: RainGauge['position'] = { lon, lat: 43.4 },
): RainGauge {
  return {
    id,
    code: null,
    name,
    comment: null,
    townCode: null,
    altitude: null,
    position,
    quantities: null,
  }
}

/**
 * A camera's view, and the copies the replay holds of it.
 *
 * Shared by the suites of the strip and of the map: both decide what to show
 * from the same two paths, and two factories with two sets of defaults would
 * let one of them prove what the other contradicts.
 */
export function aView(one: {
  code?: string
  at: string
  storedPath?: string | null
  storedThumbPath?: string | null
}): FrozenWebcamImage {
  const code = one.code ?? '215'

  return {
    code,
    at: one.at,
    uri: `https://media.ceneau.test/${code}/${one.at}.jpg`,
    thumbUri: null,
    storedPath: one.storedPath === undefined ? `webcams/${code}/${one.at}.jpg` : one.storedPath,
    storedThumbPath: one.storedThumbPath ?? null,
  }
}

/**
 * A crossing of a station's threshold, as a replay holds it.
 *
 * Shared by every suite reading events: two factories with two sets of defaults
 * would let one of them prove what the other contradicts.
 */
export function aCrossing(one: Partial<ReplayEvent> & { sourceId: number }): ReplayEvent {
  return {
    id: `c${String(one.sourceId)}-${String(one.severity ?? 1)}`,
    origin: 'automatic',
    category: 'threshold-crossing',
    title: 'Vigilance',
    description: null,
    provenance: null,
    severity: 1,
    color: '#ffff00',
    from: '2019-10-22T06:00:00.000Z',
    to: '2019-10-22T12:00:00.000Z',
    position: null,
    media: [],
    crossing: null,
    ...one,
  }
}

/**
 * What a crossing rests on, with every field the contract asks for.
 *
 * Whole rather than cast from a couple of fields: a screen reading one more of
 * them would otherwise read `undefined` under a green suite.
 */
export function aThreshold(one: Partial<ThresholdCrossing> = {}): ThresholdCrossing {
  return {
    thresholdId: 1,
    label: 'Vigilance',
    quantity: 'flow',
    value: 2.8,
    measured: 3.07,
    peak: 6.6,
    ladderHeight: 4,
    natureIsFallback: false,
    stillActiveAtEnd: false,
    ...one,
  }
}

export function aCamera(code = '215', commune = 'Mailhac'): Webcam {
  return {
    code,
    commune,
    url: `https://media.ceneau.test/${code}`,
    operational: true,
    position: { lon: 2.82, lat: 43.3 },
  }
}

/** A radar rainfall series, of a delivery the replay indexed. */
export function aSeries(one: Partial<RadarRainfallSeries> = {}): RadarRainfallSeries {
  return {
    delivery: 'predictlayers_rejeux_2019',
    product: 'pluvio24h',
    medianStepMinutes: 5,
    frames: [],
    ...one,
  }
}

/** A threshold of a station, as the replay froze it. */
export function aThresholdOf(one: Partial<Threshold> & { stationId: number }): Threshold {
  return {
    id: 1,
    label: 'Vigilance',
    quantity: 'flow',
    value: 2.8,
    nature: 'alert-level',
    natureIsFallback: false,
    color: '#ffff00',
    ...one,
  }
}

/** One measure of one source, at one instant. */
export function aMeasure(
  sourceId: number,
  at: string,
  value: number,
  quantity: Measure['quantity'] = 'flow',
): Measure {
  return { sourceId, quantity, at, value }
}

/**
 * One family as `TrackList` draws it: the lanes shown, and the count held back.
 *
 * The screen's own two lines, so a suite asserting on them cannot drift from
 * what a reader sees. `lanesOf` answers for the replay alone.
 */
export function shown(families: readonly Family[], id: string, mutesShown = true) {
  const family = families.find((one) => one.id === id)
  if (family === undefined) return undefined

  const lanes = mutesShown ? family.lanes : speaking(family)
  return { ...family, lanes, held: family.lanes.length - lanes.length }
}
