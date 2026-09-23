import { describe, expect, it } from 'vitest'

import { formatHour, formatInstant, toInstant, toLocalInput } from '../src/time.ts'

describe('a French wall time turned into an instant', () => {
  it('takes two hours off in summer', () => {
    expect(toInstant('2019-10-22T06:00')).toBe('2019-10-22T04:00:00.000Z')
  })

  it('takes one hour off in winter', () => {
    expect(toInstant('2018-12-15T06:00')).toBe('2018-12-15T05:00:00.000Z')
  })

  /**
   * The clocks change at the end of October, in the middle of the season this
   * tool replays: an hour lost here shifts a whole episode, and nothing on
   * screen would say so.
   */
  it('keeps the first of the two hours that bear the same name', () => {
    // On 2019-10-27, 02:30 happens twice in Paris: at 00:30Z, then at 01:30Z.
    expect(toInstant('2019-10-27T02:30')).toBe('2019-10-27T00:30:00.000Z')
  })

  it('takes the instant that follows an hour the calendar skipped', () => {
    // On 2019-03-31, 02:30 never happens: the clock jumps from 02:00 to 03:00.
    expect(toInstant('2019-03-31T02:30')).toBe('2019-03-31T01:30:00.000Z')
  })

  it('refuses what is not a wall time', () => {
    expect(toInstant('')).toBeUndefined()
    expect(toInstant('hier')).toBeUndefined()
  })
})

describe('an instant read back', () => {
  it('is the hour an agent would have seen that day', () => {
    expect(toLocalInput('2019-10-22T04:00:00.000Z')).toBe('2019-10-22T06:00')
    expect(toLocalInput('2018-12-15T05:00:00.000Z')).toBe('2018-12-15T06:00')
  })

  it('goes back through the conversion it came from', () => {
    for (const local of ['2019-10-22T06:00', '2018-12-15T06:00', '2019-06-01T00:00']) {
      expect(toLocalInput(toInstant(local) ?? '')).toBe(local)
    }
  })

  it('reads as a date and an hour, in French', () => {
    expect(formatInstant('2019-10-22T04:00:00.000Z')).toContain('06:00')
    expect(formatHour('2019-10-22T04:00:00.000Z')).toBe('06:00')
  })
})
