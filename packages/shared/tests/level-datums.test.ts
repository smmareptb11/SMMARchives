import { describe, expect, it } from 'vitest'

import { levelDatumOf } from '../src/reference/level-datums.ts'

describe('what a station measures its level from', () => {
  /**
   * Their levels sit at their altitude in every episode replayed — Badens' at
   * 80.93 for 80.93, the Cuxac spillway's at 9.41 for 9.48 — and never fall
   * under two metres, which no level read from a gauge zero does here.
   */
  it('is metres NGF for the structures the source measures so', () => {
    for (const id of [2, 3, 4, 5, 6, 7, 8, 21, 38, 39, 40, 41, 45, 59, 60, 81, 82]) {
      expect(levelDatumOf(id), String(id)).toBe('ngf')
    }
  })

  it('is the gauge zero for every other station', () => {
    for (const id of [1, 12, 32, 57, 73, 84, 159]) {
      expect(levelDatumOf(id), String(id)).toBe('gauge')
    }
  })
})
