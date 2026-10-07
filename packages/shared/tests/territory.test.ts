import { describe, expect, it } from 'vitest'

import { contains } from '../src/contracts/geometry.ts'
import { SMMAR_TERRITORY } from '../src/reference/territory.ts'

describe('the SMMAR territory', () => {
  /**
   * The fleet's outermost sources, read off a replay of the whole territory:
   * all rain gauges, each outside the perimeters of the SMMAR.
   */
  it.each([
    ['Béziers-Vias, farthest east', { lon: 3.352667, lat: 43.322 }],
    ['ERA5 Pamiers, farthest west', { lon: 1.75, lat: 43.25 }],
    ['ERA5 Castres, farthest north', { lon: 2.25, lat: 43.5 }],
    ['SAFRAN Font-Romeu-Odeillo-Via, farthest south', { lon: 2.093939, lat: 42.492675 }],
  ])('holds %s', (_name, position) => {
    expect(contains(SMMAR_TERRITORY, position)).toBe(true)
  })
})
