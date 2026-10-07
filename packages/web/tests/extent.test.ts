import { SMMAR_TERRITORY } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { cornersOf, extentBetween, reachOf } from '../src/creation/extent.ts'

const VIEW = { width: 500, height: 300 }

describe('the corners of a frame', () => {
  it('put south-west at the bottom left, the y axis pointing down', () => {
    expect(cornersOf({ left: 0.2, top: 0.1, right: 0.6, bottom: 0.9 }, VIEW)).toEqual({
      southWest: { x: 100, y: 270 },
      northEast: { x: 300, y: 30 },
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
