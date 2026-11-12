import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import { historyAt } from '../src/events/history.ts'
import { pointedOf, pointerOf, type Pointed } from '../src/map/pointed.ts'
import { pointedFilterOf } from '../src/map/pointing.ts'
import type { Kind } from '../src/map/sources.ts'
import { gaugesOf } from '../src/rain.ts'
import { lanesOf } from '../src/tracks/lanes.ts'
import {
  aCamera,
  aCrossing,
  aGauge,
  aMeasure,
  aReport,
  aStation,
  aView,
  at,
  held,
} from './support/content.ts'

/** Whether the lit layer of a family would draw a feature carrying these properties. */
function lit(
  kind: Kind,
  pointed: Pointed | undefined,
  properties: Record<string, unknown>,
  mutesShown = false,
): boolean {
  const filter = featureFilter(pointedFilterOf(kind, pointed, mutesShown), 'layers[0].filter')
  return filter.filter({ zoom: 10 }, { type: 1, properties })
}

describe('what the map lights up for the pointer', () => {
  const trebes = { kind: 'watercourse', id: 84, mute: false }

  it('lights up the source it rests on, and none beside it', () => {
    expect(lit('watercourse', { source: 'watercourse', id: 84 }, trebes)).toBe(true)
    expect(lit('watercourse', { source: 'watercourse', id: 84 }, { ...trebes, id: 85 })).toBe(false)
  })

  /** A station and a rain gauge can share an identifier. */
  it('lights up the source of its own family only', () => {
    const gauge = { kind: 'rain-gauge', id: 84, mute: false }

    expect(lit('rain-gauge', { source: 'watercourse', id: 84 }, gauge)).toBe(false)
    expect(lit('watercourse', { source: 'rain-gauge', id: 84 }, trebes)).toBe(false)
  })

  it('lights up nothing where the switch holds the source back', () => {
    const silent = { ...trebes, mute: true }

    expect(lit('watercourse', { source: 'watercourse', id: 84 }, silent)).toBe(false)
    expect(lit('watercourse', { source: 'watercourse', id: 84 }, silent, true)).toBe(true)
  })

  it('lights up no source while it rests on nothing, or on a report', () => {
    expect(lit('watercourse', undefined, trebes)).toBe(false)
    expect(lit('watercourse', { report: 'r' }, trebes)).toBe(false)
  })
})

describe('where a lane stands on the map', () => {
  const content = held({
    stations: [aStation(84, 'Trèbes'), aStation(3, 'Digue de Cuxac', 'structure')],
    rainGauges: [aGauge(4, 'Couiza', 2.2)],
    rain: gaugesOf([aMeasure(4, '2019-10-22T06:00:00.000Z', 3, 'rainfall')]),
    webcams: [aCamera('215', 'Mailhac')],
  })
  const pointed = Object.fromEntries(
    lanesOf(content).flatMap((family) => family.lanes.map((one) => [one.label, one.pointed])),
  )

  it('is its station, in its own family', () => {
    expect(pointed.Trèbes).toEqual({ source: 'watercourse', id: 84 })
    expect(pointed['Digue de Cuxac']).toEqual({ source: 'structure', id: 3 })
  })

  it('is its rain gauge, or its camera', () => {
    expect(pointed.Couiza).toEqual({ source: 'rain-gauge', id: 4 })
    expect(pointed.Mailhac).toEqual({ camera: '215' })
  })

  it('is nowhere for a camera known by its pictures alone', () => {
    const pictured = held({
      images: [aView({ code: '999', at: '2019-10-22T06:00:00.000Z' })],
    })
    const lanes = lanesOf(pictured).flatMap((family) => family.lanes)

    expect(lanes.find((one) => one.id === 'webcam-999')?.pointed).toBeUndefined()
  })
})

describe('where a card of the history stands on the map', () => {
  const stations = [aStation(3, 'Digue de Cuxac', 'structure')]
  const entries = historyAt(
    [
      aCrossing({ id: 'c', sourceId: 3 }),
      aCrossing({ id: 'lost', sourceId: 99 }),
      aReport({ id: 'r' }),
    ],
    stations,
    at('2019-10-23T00:00:00.000Z'),
  )
  const of = (id: string) => {
    const entry = entries.find((one) => one.id === id)
    return entry === undefined ? 'no such entry' : pointedOf(entry, stations)
  }

  it('is the station of a crossing, or the report itself', () => {
    expect(of('c')).toEqual({ source: 'structure', id: 3 })
    expect(of('r')).toEqual({ report: 'r' })
  })

  it('is nowhere for a crossing of a station the replay does not hold', () => {
    expect(of('lost')).toBeUndefined()
  })
})

describe('the pointer the lanes and the map share', () => {
  it('tells its listeners where it rests, once per change', () => {
    const pointer = pointerOf()
    const heard: (Pointed | undefined)[] = []
    const stop = pointer.subscribe((one) => heard.push(one))

    pointer.set({ camera: '215' })
    pointer.set({ camera: '215' })
    pointer.set(undefined)
    stop()
    pointer.set({ report: 'r' })

    expect(heard).toEqual([{ camera: '215' }, undefined])
    expect(pointer.get()).toEqual({ report: 'r' })
  })
})
