import { describe, expect, it } from 'vitest'

import { heightAfterKey, KEY_STEP, rangeOf, within } from '../src/transport/montageHeight.ts'

describe('the height of the lanes’ panel', () => {
  it('runs from folded to half the area under the band', () => {
    expect(rangeOf(215, 752)).toEqual({ min: 215, max: 376 })
  })

  it('never offers less than folded, on a window too short for the half', () => {
    expect(rangeOf(215, 300)).toEqual({ min: 215, max: 215 })
  })

  it('holds a drag within its range', () => {
    const range = rangeOf(215, 752)

    expect(within(100, range)).toBe(215)
    expect(within(300, range)).toBe(300)
    expect(within(900, range)).toBe(376)
  })

  it('grows on the up arrow, as a drag upwards does, and jumps to either end', () => {
    const range = rangeOf(215, 752)

    expect(heightAfterKey(300, 'ArrowUp', range)).toBe(300 + KEY_STEP)
    expect(heightAfterKey(300, 'ArrowDown', range)).toBe(300 - KEY_STEP)
    expect(heightAfterKey(370, 'ArrowUp', range)).toBe(376)
    expect(heightAfterKey(300, 'Home', range)).toBe(215)
    expect(heightAfterKey(300, 'End', range)).toBe(376)
    expect(heightAfterKey(300, 'ArrowLeft', range)).toBeUndefined()
  })
})
