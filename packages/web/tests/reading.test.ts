import { describe, expect, it } from 'vitest'

import {
  advanced,
  atTheEnd,
  clamped,
  cursorAt,
  fractionOf,
  frameElapsed,
  nextMark,
  previousMark,
  resumes,
  shortcutFor,
  startOf,
  stepped,
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

describe('the reading once a drag lets it go', () => {
  const day = { from: '2019-10-21T22:00:00.000Z', to: '2019-10-22T22:00:00.000Z' }

  it('goes on if it was playing', () => {
    expect(resumes(true, day, Date.parse('2019-10-22T08:00:00.000Z'))).toBe(true)
  })

  it('stays still if it was not', () => {
    expect(resumes(false, day, Date.parse('2019-10-22T08:00:00.000Z'))).toBe(false)
  })

  /** Played from the end, it would advance nothing and leave the button pressed. */
  it('stays still at the end, even if it was playing', () => {
    expect(resumes(true, day, Date.parse(day.to))).toBe(false)
  })
})

describe('a frame of the reading', () => {
  it('counts the time since the one before it', () => {
    expect(frameElapsed(1_016, 1_000)).toBe(16)
  })

  /** Ten minutes away from the tab at sixty minutes a second is ten hours of replay. */
  it('counts no more than a quarter of a second after the tab was hidden', () => {
    expect(frameElapsed(600_000, 0)).toBe(250)
    expect(advanced(period, noon, frameElapsed(600_000, 0), 60)).toBe(noon + 15 * 60_000)
  })
})

describe('a step of the keyboard', () => {
  it('moves the reading by an hour, either way', () => {
    expect(stepped(period, noon, 1)).toBe(noon + 60 * 60_000)
    expect(stepped(period, noon, -1)).toBe(noon - 60 * 60_000)
  })

  it('stays within the period', () => {
    expect(stepped(period, at('2019-10-22T23:30:00.000Z'), 1)).toBe(at('2019-10-23T00:00:00.000Z'))
    expect(stepped(period, at('2019-10-22T00:30:00.000Z'), -1)).toBe(at('2019-10-22T00:00:00.000Z'))
  })
})

describe('a key pressed during the reading', () => {
  it('plays with space, jumps with an arrow, and steps with Shift and an arrow', () => {
    expect(shortcutFor(' ', false, 'none')).toBe('toggle')
    expect(shortcutFor('ArrowRight', false, 'none')).toBe('next')
    expect(shortcutFor('ArrowLeft', false, 'none')).toBe('previous')
    expect(shortcutFor('ArrowRight', true, 'none')).toBe('forward')
    expect(shortcutFor('ArrowLeft', true, 'none')).toBe('back')
  })

  /** Focus stays on « Événement suivant » once it is clicked: the arrows must go on working. */
  it('keeps the arrows working on a button just clicked, and leaves it its space', () => {
    expect(shortcutFor('ArrowRight', false, 'pressable')).toBe('next')
    expect(shortcutFor(' ', false, 'pressable')).toBeUndefined()
  })

  it('leaves every key to a field being typed into', () => {
    for (const key of [' ', 'ArrowLeft', 'ArrowRight']) {
      expect(shortcutFor(key, false, 'typing')).toBeUndefined()
    }
  })

  it('leaves the arrows to the map, which pans with them, and plays with space there', () => {
    expect(shortcutFor('ArrowRight', false, 'map')).toBeUndefined()
    expect(shortcutFor(' ', false, 'map')).toBe('toggle')
  })

  it('does nothing with another key', () => {
    expect(shortcutFor('a', false, 'none')).toBeUndefined()
  })
})
