import { describe, expect, it } from 'vitest'

import { fractionAcross } from '../src/tracks/pointer.ts'

describe('where a click stands across a lane', () => {
  it('is its distance from the left edge, over the width', () => {
    expect(fractionAcross(310, 210, 400)).toBe(0.25)
  })

  /** The lanes start after their labels: the left edge is the track's, not the screen's. */
  it('counts from the left edge of the box, wherever it stands', () => {
    expect(fractionAcross(210, 210, 400)).toBe(0)
    expect(fractionAcross(610, 210, 400)).toBe(1)
  })
})
