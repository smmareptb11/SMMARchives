import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import { cornersOf, filterOf, redraws, showRadar, type RadarCanvas } from '../src/map/layers.ts'
import { FRANCE } from './support/content.ts'
import type { Kind } from '../src/map/sources.ts'

/** Whether a layer would draw a feature carrying these properties. */
function draws(kind: Kind, mutesShown: boolean, properties: Record<string, unknown>): boolean {
  // The key names where the expression would sit in a style; nothing reads it
  // back, and the validator refuses to run without one.
  const filter = featureFilter(filterOf(kind, mutesShown), 'layers[0].filter')

  return filter.filter({ zoom: 10 }, { type: 1, properties })
}

describe('what a family layer draws', () => {
  it('draws the sources of its own family and no other', () => {
    expect(draws('rain-gauge', false, { kind: 'rain-gauge', mute: false })).toBe(true)
    expect(draws('rain-gauge', false, { kind: 'watercourse', mute: false })).toBe(false)
  })

  it('leaves out the sources the replay holds nothing of, until they are asked for', () => {
    expect(draws('rain-gauge', false, { kind: 'rain-gauge', mute: true })).toBe(false)
    expect(draws('rain-gauge', true, { kind: 'rain-gauge', mute: true })).toBe(true)
  })

  /**
   * A replay drawn from a build older than the property carries no `mute` at
   * all. Negated rather than compared with `true`, the filter would read that
   * absence as « mute » and empty the map of a parc nothing is known against.
   */
  it('draws a source carrying no answer either way', () => {
    expect(draws('watercourse', false, { kind: 'watercourse' })).toBe(true)
  })
})

describe('where a radar rainfall image is laid on the map', () => {
  /**
   * MapLibre wants the four corners clockwise from the north-west, longitude
   * first. Swapped, the mosaic lands in the Indian Ocean; rolled by one corner
   * it lands mirrored over the right extent, which still looks like rain. The
   * extent itself is already unconfirmed — this is the one part of the placing
   * that a test can hold still.
   */
  it('is its four corners, longitude first, clockwise from the north-west', () => {
    expect(cornersOf(FRANCE)).toEqual([
      [-9.97, 54.18],
      [14.55, 54.18],
      [14.55, 39.46],
      [-9.97, 39.46],
    ])
  })
})

/** Enough of a map to answer the three questions `showRadar` asks of one. */
function aMap(holds = true) {
  const calls: string[] = []
  const source = {
    updateImage: ({ url }: { url: string }) => calls.push(`image ${url}`),
  }
  const map: RadarCanvas = {
    getLayer: () => (holds ? {} : undefined),
    getSource: () => source,
    setLayoutProperty: (_layer, _name, value) => {
      calls.push(`visibility ${String(value)}`)
    },
  }

  return { map, calls }
}

describe('drawing the rainfall image the reading stands on', () => {
  it('puts the image on the layer and shows it', () => {
    const { map, calls } = aMap()
    showRadar(map, '/replays/a/media/radar/20034/pluvio1h/1571745600.png')

    expect(calls).toEqual([
      'image /replays/a/media/radar/20034/pluvio1h/1571745600.png',
      'visibility visible',
    ])
  })

  /**
   * No address is a hole in the delivery, not a layer the reader cut off — and
   * the layer goes dark rather than keeping the image it last had, which a
   * reader would take for the cumul they are looking at.
   */
  it('hides the layer when there is no image to put on it', () => {
    const { map, calls } = aMap()
    showRadar(map, undefined)

    expect(calls).toEqual(['visibility none'])
  })

  /**
   * The replay holds no rainfall, so `drawRadar` added nothing. Reached on every
   * tick of the reading, and MapLibre throws on a layer it does not have.
   */
  it('does nothing at all on a map that carries no rainfall layer', () => {
    const { map, calls } = aMap(false)
    showRadar(map, '/replays/a/media/radar/x.png')

    expect(calls).toEqual([])
  })
})

describe('whether the rainfall image has to be drawn again', () => {
  const one = aMap().map
  const other = aMap().map

  /**
   * The guard exists because the reading advances sixty times a second:
   * reassigning the same address makes the browser release the image and fetch
   * it again, for every frame.
   */
  it('is not, for the same address on the same map', () => {
    expect(redraws({ map: one, url: '/a.png' }, { map: one, url: '/a.png' })).toBe(false)
  })

  it('is, as soon as the address changes', () => {
    expect(redraws({ map: one, url: '/a.png' }, { map: one, url: '/b.png' })).toBe(true)
    expect(redraws({ map: one, url: '/a.png' }, { map: one, url: undefined })).toBe(true)
  })

  /**
   * A map torn down takes its layers with it, and the next one opens without
   * the image. Judged on the map's own identity, or the reading would have to
   * move before anything was drawn again.
   */
  it('is, on a map that is not the one it was drawn on', () => {
    expect(redraws({ map: one, url: '/a.png' }, { map: other, url: '/a.png' })).toBe(true)
    expect(redraws(undefined, { map: one, url: undefined })).toBe(true)
  })
})
