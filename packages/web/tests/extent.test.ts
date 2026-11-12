import { SMMAR_TERRITORY } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { cornersOf, extentBetween, lonLatAt, paddingOf, reachOf } from '../src/creation/extent.ts'

const VIEW = { width: 500, height: 300 }

describe('the corners of a frame', () => {
  it('put south-west at the bottom left, the y axis pointing down', () => {
    expect(cornersOf({ left: 0.2, top: 0.1, right: 0.6, bottom: 0.9 }, VIEW)).toEqual({
      southWest: { x: 100, y: 270 },
      northEast: { x: 300, y: 30 },
    })
  })
})

describe('the padding of a frame', () => {
  it('leaves on each side of the view the margin the frame leaves there', () => {
    expect(paddingOf({ left: 0.25, top: 0.125, right: 0.5, bottom: 0.75 }, VIEW)).toEqual({
      top: 37.5,
      right: 250,
      bottom: 75,
      left: 125,
    })
  })
})

describe('the reach of a frame', () => {
  it('runs past each side of the view by the margin the frame leaves there', () => {
    expect(reachOf({ left: 0.2, top: 0.1, right: 0.6, bottom: 0.9 }, VIEW)).toEqual({
      southWest: { x: -100, y: 330 },
      northEast: { x: 700, y: -30 },
    })
  })
})

describe('the extent a frame lands on', () => {
  it('orders the corners into the extent the API reads', () => {
    expect(extentBetween({ lon: 3.1, lat: 43.25 }, { lon: 2.9, lat: 43.1 })).toEqual({
      minLon: 2.9,
      minLat: 43.1,
      maxLon: 3.1,
      maxLat: 43.25,
    })
  })

  it('keeps only what it frames of the territory', () => {
    expect(extentBetween({ lon: 3, lat: 43.3 }, { lon: 3.6, lat: 43.8 })).toEqual({
      minLon: 3,
      minLat: 43.3,
      maxLon: SMMAR_TERRITORY.maxLon,
      maxLat: SMMAR_TERRITORY.maxLat,
    })
  })

  it('is the whole territory when it frames more than all of it', () => {
    expect(extentBetween({ lon: -200, lat: -80 }, { lon: 250, lat: 80 })).toEqual(SMMAR_TERRITORY)
  })

  it('is nothing outside the territory', () => {
    expect(extentBetween({ lon: 5.3, lat: 43.2 }, { lon: 5.5, lat: 43.4 })).toBeUndefined()
  })
})

describe('a pixel of the view a map opened on', () => {
  const size = { width: 800, height: 600 }

  it('lands on the centre of the view at its middle', () => {
    const [lon, lat] = lonLatAt([2.55, 43.0], 7.3, size, { x: 400, y: 300 })
    expect(lon).toBeCloseTo(2.55, 9)
    expect(lat).toBeCloseTo(43.0, 9)
  })

  /** At zoom 0 the world is 512 pixels wide: a quarter of it is ninety degrees. */
  it('moves by the degrees the Web Mercator scale gives', () => {
    const [lon, lat] = lonLatAt([0, 0], 0, { width: 512, height: 512 }, { x: 384, y: 256 })
    expect(lon).toBeCloseTo(90, 9)
    expect(lat).toBeCloseTo(0, 9)
  })

  it('reads north up, a pixel higher on the screen standing further north', () => {
    const [, above] = lonLatAt([2.55, 43.0], 7.3, size, { x: 400, y: 0 })
    const [, below] = lonLatAt([2.55, 43.0], 7.3, size, { x: 400, y: 600 })
    expect(above).toBeGreaterThan(43.0)
    expect(below).toBeLessThan(43.0)
  })

  it('reaches further for a wider view, which is why a resize asks again', () => {
    const narrow = lonLatAt([2.55, 43.0], 7.3, size, { x: 800, y: 300 })[0]
    const wide = lonLatAt([2.55, 43.0], 7.3, { width: 1600, height: 600 }, { x: 1600, y: 300 })[0]
    expect(wide).toBeGreaterThan(narrow)
  })
})
