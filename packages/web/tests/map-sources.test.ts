import type { Feature, Point } from 'geojson'
import { describe, expect, it } from 'vitest'

import { boundsOf, sourceUnder, sourcesOf } from '../src/map/sources.ts'
import { gaugesOf } from '../src/rain.ts'
import { aGauge, aMeasure, aStation, held } from './support/content.ts'

/** GeoJSON properties are `any` by contract; the test does not pass that on. */
const propertyOf = (feature: Feature<Point>, name: string): unknown => feature.properties?.[name]

describe('a source the replay holds nothing of', () => {
  const parc = {
    rainGauges: [aGauge(4, 'Couiza', 2.2), aGauge(9, 'Villegly', 2.4)],
    rain: gaugesOf([aMeasure(9, '2019-10-22T06:00:00.000Z', 3, 'rainfall')]),
  }

  /**
   * Carried on the feature rather than rebuilt into a filter: what a source is
   * does not change with the cursor, so the layer says whether it draws the
   * mute ones and MapLibre reads the answer off the parc it already holds.
   */
  it('says so on the feature, and says nothing of the ones that measured', () => {
    const { geojson } = sourcesOf(held(parc))

    expect(geojson.features.map((one) => propertyOf(one, 'mute'))).toEqual([true, false])
  })

  it('is not mute on a replay that holds no rain at all, only unknown', () => {
    const { geojson } = sourcesOf(held({ ...parc, rain: undefined }))

    expect(geojson.features.map((one) => propertyOf(one, 'mute'))).toEqual([false, false])
  })

  it('is never a station: this screen does not load their measures', () => {
    const { geojson } = sourcesOf(held({ stations: [aStation(9, 'Trèbes')], ...parc }))

    expect(geojson.features.map((one) => propertyOf(one, 'mute'))).toEqual([false, true, false])
  })
})

describe('the sources of a replay, as the map reads them', () => {
  it('gives each family its shape', () => {
    const { geojson } = sourcesOf(
      held({
        stations: [aStation(1, 'Une', 'watercourse'), aStation(2, 'Deux', 'structure')],
        rainGauges: [aGauge(3, 'Pluvio', 2.7)],
      }),
    )

    expect(geojson.features.map((one) => propertyOf(one, 'kind'))).toEqual([
      'watercourse',
      'structure',
      'rain-gauge',
    ])
  })

  /**
   * GeoJSON orders a position longitude first, and nothing downstream would
   * say otherwise: swapped, the whole parc lands off Somalia and the map looks
   * like a map. `AGENTS.md` says it of the radar extent, and it is the same
   * failure — a layer shifted whole, with nothing to signal it.
   */
  it('places a source longitude first, as GeoJSON orders a position', () => {
    const { geojson } = sourcesOf(held({ stations: [aStation(1, 'Une', 'watercourse')] }))

    expect(geojson.features[0]?.geometry.coordinates).toEqual([2.4, 43.2])
  })

  /**
   * Longitude 0, latitude 0 is in the Gulf of Guinea. A station drawn there
   * reads as a broken projection rather than as a position the source never
   * gave, so it is dropped — and counted, because an absence says nothing.
   */
  it('drops a source with no position, and says how many it dropped', () => {
    const { geojson, placeless } = sourcesOf(
      held({
        stations: [aStation(1, 'Une', 'watercourse', null), aStation(2, 'Deux', 'watercourse')],
      }),
    )

    expect(geojson.features).toHaveLength(1)
    expect(placeless).toBe(1)
  })

  /** The colour expression matches on this, and a bare identifier names two sources. */
  it('keys a source by its family and its identifier, never by the identifier alone', () => {
    const { geojson } = sourcesOf(
      held({
        stations: [aStation(4, 'Quatre', 'watercourse')],
        rainGauges: [aGauge(4, 'Pluvio', 2.7)],
      }),
    )

    expect(geojson.features.map((one) => propertyOf(one, 'key'))).toEqual([
      'watercourse:4',
      'rain-gauge:4',
    ])
  })

  it('frames the map on everything it holds', () => {
    expect(
      boundsOf(
        held({
          stations: [aStation(1, 'Une', 'watercourse')],
          rainGauges: [aGauge(2, 'Pluvio', 3.1)],
        }),
      ),
    ).toEqual([
      [2.4, 43.2],
      [3.1, 43.4],
    ])
  })

  it('frames nothing when it holds nothing placed', () => {
    expect(boundsOf(held())).toBeUndefined()
    expect(boundsOf(held({ stations: [aStation(1, 'Une', 'watercourse', null)] }))).toBeUndefined()
  })
})

describe('which of the sources under a pointer a click is about', () => {
  // The features the map itself drew, and not a hand-written copy of them: the
  // properties read here are the ones `sourcesOf` writes, and a test spelling
  // them out again would stay green through a rename that breaks the map.
  const drawn = (content: Parameters<typeof sourcesOf>[0]) => sourcesOf(content).geojson.features

  /** The topmost layer answers first, and that is the rain gauges'. */
  const asQueried = <T>(features: T[]) => [...features].reverse()

  it('is the station, when a rain gauge is under the pointer too', () => {
    const features = drawn(
      held({ stations: [aStation(4, 'Trèbes')], rainGauges: [aGauge(4, 'SAFRAN Trèbes', 2.4)] }),
    )

    expect(sourceUnder(asQueried(features))).toEqual({
      kind: 'watercourse',
      id: 4,
      name: 'Trèbes',
      at: [2.4, 43.2],
    })
  })

  it('is the first of them when they are all rain gauges', () => {
    const features = drawn(held({ rainGauges: [aGauge(4, 'Un', 2.4), aGauge(5, 'Deux', 2.5)] }))

    expect(sourceUnder(features)?.name).toBe('Un')
  })

  /** The bubble is anchored on the source, not on the point that was clicked. */
  it('carries the point the source was drawn at', () => {
    const features = drawn(
      held({ stations: [aStation(9, 'Puichéric', 'structure', { lon: 2.9, lat: 43.1 })] }),
    )

    expect(sourceUnder(features)?.at).toEqual([2.9, 43.1])
  })

  it('is nothing at all under a feature that carries no source', () => {
    const foreign = {
      properties: { name: 'Syndicat' },
      geometry: { type: 'Point' as const, coordinates: [2.4, 43.2] },
    }

    expect(sourceUnder([foreign])).toBeUndefined()
  })

  it('is nothing at all under nothing', () => {
    expect(sourceUnder([])).toBeUndefined()
  })
})
