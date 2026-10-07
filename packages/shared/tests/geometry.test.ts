import { describe, expect, it } from 'vitest'

import { encloses, intersectionOf } from '../src/contracts/geometry.ts'

const OUTER = { minLon: 2, minLat: 42.5, maxLon: 3, maxLat: 43.5 }

describe('an extent within another', () => {
  it('lies within it up to its edges', () => {
    expect(encloses(OUTER, OUTER)).toBe(true)
    expect(encloses(OUTER, { minLon: 2.2, minLat: 42.8, maxLon: 2.6, maxLat: 43.1 })).toBe(true)
  })

  it('does not when a single side crosses out', () => {
    expect(encloses(OUTER, { minLon: 2.2, minLat: 42.8, maxLon: 3.1, maxLat: 43.1 })).toBe(false)
    expect(encloses(OUTER, { minLon: 2.2, minLat: 42.4, maxLon: 2.6, maxLat: 43.1 })).toBe(false)
  })
})

describe('what two extents share', () => {
  it('is the area both cover', () => {
    expect(intersectionOf(OUTER, { minLon: 2.5, minLat: 43, maxLon: 4, maxLat: 44 })).toEqual({
      minLon: 2.5,
      minLat: 43,
      maxLon: 3,
      maxLat: 43.5,
    })
  })

  it('is nothing when they only touch, or lie apart', () => {
    expect(intersectionOf(OUTER, { minLon: 3, minLat: 43, maxLon: 4, maxLat: 44 })).toBeUndefined()
    expect(intersectionOf(OUTER, { minLon: 5, minLat: 43, maxLon: 6, maxLat: 44 })).toBeUndefined()
  })
})
