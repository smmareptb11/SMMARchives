import { describe, expect, it } from 'vitest'

import { LEAST, offsetWithin, sizeWithin } from '../src/map/floating.ts'

const screen = { width: 1000, height: 800 }
const box = { left: 12, top: 400, width: 560, height: 300 }

describe('where a floating panel goes', () => {
  it('goes where it is pushed, while the screen holds it', () => {
    expect(offsetWithin(box, { x: 200, y: -150 }, screen)).toEqual({ x: 200, y: -150 })
  })

  it('stops at the edges of the screen', () => {
    expect(offsetWithin(box, { x: -50, y: -900 }, screen)).toEqual({ x: -12, y: -400 })
    expect(offsetWithin(box, { x: 900, y: 500 }, screen)).toEqual({ x: 428, y: 100 })
  })

  it('keeps its top and its left in sight when the screen is smaller than it', () => {
    const tall = { left: 12, top: 100, width: 1200, height: 900 }

    expect(offsetWithin(tall, { x: 40, y: 40 }, screen)).toEqual({ x: -12, y: -100 })
  })
})

describe('the size a window is given by its corner', () => {
  const screen = { width: 1500, height: 1000 }
  const at = { left: 100, top: 60 }

  it('is the size asked for, when the screen has room for it', () => {
    expect(sizeWithin(at, { width: 800, height: 500 }, screen)).toEqual({ width: 800, height: 500 })
  })

  it('is never under the least a window is made', () => {
    expect(sizeWithin(at, { width: 50, height: -40 }, screen)).toEqual(LEAST)
  })

  /** Its corner, which is what resizes it, stays where a pointer can take it again. */
  it('stops at the right and bottom edges of the screen, from where the window stands', () => {
    expect(sizeWithin(at, { width: 3000, height: 3000 }, screen)).toEqual({
      width: 1400,
      height: 940,
    })
    expect(sizeWithin({ left: 900, top: 600 }, { width: 3000, height: 3000 }, screen)).toEqual({
      width: 600,
      height: 400,
    })
  })

  it('keeps the least a window is made, even where the screen leaves less', () => {
    expect(sizeWithin({ left: 1400, top: 950 }, { width: 900, height: 900 }, screen)).toEqual(LEAST)
  })
})
