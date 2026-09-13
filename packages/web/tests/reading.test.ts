import { describe, expect, it } from 'vitest'

import {
  advanced,
  atTheEnd,
  clamped,
  cursorAt,
  fractionOf,
  nearestTo,
  nextMark,
  previousMark,
  startOf,
} from '../src/transport/reading.ts'
import { period } from './support/content.ts'

const at = (iso: string) => Date.parse(iso)
const noon = at('2019-10-22T12:00:00.000Z')

describe('the cursor of a replay', () => {
  // Against a literal and not against `Date.parse(period.from)`: an unreadable
  // period would make both sides `NaN`, and `toBe` holds `NaN` equal to itself.
  it('starts at the beginning of the period', () => {
    expect(startOf(period)).toBe(at('2019-10-22T00:00:00.000Z'))
  })

  it('never leaves the period, whichever side it is pushed', () => {
    expect(clamped(period, at('2019-10-01T00:00:00.000Z'))).toBe(at('2019-10-22T00:00:00.000Z'))
    expect(clamped(period, at('2019-11-01T00:00:00.000Z'))).toBe(at('2019-10-23T00:00:00.000Z'))
  })

  /**
   * Minutes of replay per second of real time, which is the unit a reader can
   * hold: at five, a day of flood takes about five minutes to watch.
   */
  it('advances by the speed chosen', () => {
    expect(advanced(period, noon, 1_000, 5)).toBe(noon + 5 * 60_000)
    expect(advanced(period, noon, 500, 60)).toBe(noon + 30 * 60_000)
  })

  it('stops at the end of the period rather than running past it', () => {
    const end = Date.parse(period.to)

    expect(advanced(period, end - 60_000, 10_000, 60)).toBe(end)
    expect(atTheEnd(period, end)).toBe(true)
    expect(atTheEnd(period, noon)).toBe(false)
  })

  /**
   * The playhead knows a fraction of the ruler, never a pixel — like a mark.
   * Read off-centre as well as at the middle: a fraction counted backwards
   * gives the same answer at midday, and would run the bar the wrong way.
   */
  it('reads as a fraction of the period, and back', () => {
    expect(fractionOf(period, noon)).toBe(0.5)
    expect(fractionOf(period, at('2019-10-22T06:00:00.000Z'))).toBe(0.25)
    expect(fractionOf(period, at('2019-10-22T00:00:00.000Z'))).toBe(0)
    expect(fractionOf(period, at('2019-10-23T00:00:00.000Z'))).toBe(1)

    expect(cursorAt(period, 0.25)).toBe(at('2019-10-22T06:00:00.000Z'))
    expect(cursorAt(period, 2)).toBe(at('2019-10-23T00:00:00.000Z'))
  })
})

describe('jumping from one event to the next', () => {
  const marks = [0, 10, 20, 30]

  it('goes to the first mark strictly after the cursor', () => {
    expect(nextMark(marks, 10)).toBe(20)
    expect(nextMark(marks, 11)).toBe(20)
  })

  it('goes to the last mark strictly before the cursor', () => {
    expect(previousMark(marks, 20)).toBe(10)
    expect(previousMark(marks, 19)).toBe(10)
  })

  /**
   * Nothing rather than the edge: a button with nowhere to go can be disabled,
   * where one that silently re-seeks where you already are reads as broken.
   */
  it('says nothing when there is none on that side', () => {
    expect(nextMark(marks, 30)).toBeUndefined()
    expect(previousMark(marks, 0)).toBeUndefined()
  })

  it('finds them whatever order they came in', () => {
    expect(nextMark([30, 0, 20, 10], 10)).toBe(20)
    expect(previousMark([30, 0, 20, 10], 25)).toBe(20)
  })
})

describe('the entry nearest an instant', () => {
  const frames = [10, 20, 40].map((at) => ({ at }))

  /**
   * Not `lastBefore`, and the difference is the whole point. A radar rainfall
   * image is stamped with the time it was produced, so no frame lands on a slot
   * and an image four minutes ahead of the reading is a better answer than one
   * six minutes behind it.
   */
  it('takes the one ahead when it is the closer of the two', () => {
    expect(nearestTo(frames, 18)).toEqual({ at: 20 })
  })

  it('takes the one behind when it is the closer of the two', () => {
    expect(nearestTo(frames, 22)).toEqual({ at: 20 })
  })

  /**
   * The earlier one, which is the one the reading has already reached: taking
   * the later would show an image of rain that has not fallen yet.
   */
  it('takes the earlier of two equally near', () => {
    expect(nearestTo(frames, 30)).toEqual({ at: 20 })
  })

  it('takes the entry the instant falls exactly on', () => {
    expect(nearestTo(frames, 40)).toEqual({ at: 40 })
  })

  it('reaches past either end, where there is only one side to take', () => {
    expect(nearestTo(frames, 0)).toEqual({ at: 10 })
    expect(nearestTo(frames, 1_000)).toEqual({ at: 40 })
  })

  it('says nothing of an empty list', () => {
    expect(nearestTo([], 20)).toBeUndefined()
  })
})
