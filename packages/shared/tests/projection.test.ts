import { describe, expect, it } from 'vitest'

import { SANDRE_LAMBERT_93, SANDRE_WGS84, sandreToWgs84 } from '../src/projection.ts'

/**
 * The check that established Sandre code 26 as EPSG:2154: applying the inverse
 * Lambert 93 puts the stations on the communes their names announce.
 */
describe('Sandre code 26, Lambert 93', () => {
  const cases = [
    { name: 'Aval Matemale', x: 627157.5088121907, y: 6165011.341631476, lon: 2.11, lat: 42.62 },
    { name: 'Axat St Georges', x: 636244.690802135, y: 6188172.987282903, lon: 2.22, lat: 42.83 },
    { name: 'Salses-le-Château', x: 696592.58, y: 6195530.377, lon: 2.94, lat: 42.86 },
  ]

  for (const { name, x, y, lon, lat } of cases) {
    it(`puts ${name} on its commune`, () => {
      const position = sandreToWgs84(x, y, SANDRE_LAMBERT_93)
      expect(position.lon).toBeCloseTo(lon, 1)
      expect(position.lat).toBeCloseTo(lat, 1)
    })
  }
})

describe('Sandre code 16, already WGS84', () => {
  it('passes degrees through instead of dropping the source in the Atlantic', () => {
    expect(sandreToWgs84(2.2955, 43.215333, SANDRE_WGS84)).toEqual({
      lon: 2.2955,
      lat: 43.215333,
    })
  })
})

describe('a source whose declared projection contradicts its values', () => {
  it('is a failure, not a position in the Atlantic', () => {
    expect(() => sandreToWgs84(627157.5, 6165011.3, SANDRE_WGS84)).toThrow(/is not degrees/)
  })
})

describe('an unverified projection code', () => {
  it('is a failure, not a guess', () => {
    expect(() => sandreToWgs84(2.2955, 43.215333, 1)).toThrow(/Unknown Sandre projection code 1/)
  })
})
