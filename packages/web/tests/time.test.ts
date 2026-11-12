import { describe, expect, it } from 'vitest'

import {
  formatDate,
  formatDay,
  formatDuration,
  formatHour,
  formatInstant,
  formatPeriod,
  formatSince,
  hourOf,
  readBack,
  epochOf,
  toInstant,
  toLocalInput,
  toLocalInputFrom,
} from '../src/time.ts'

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

  it('keeps the second of them when the field was filled from it', () => {
    expect(toInstant('2019-10-27T02:30', '2019-10-27T01:30:00.000Z')).toBe(
      '2019-10-27T01:30:00.000Z',
    )
    expect(toInstant('2019-10-27T02:45', '2019-10-27T01:30:00.000Z')).toBe(
      '2019-10-27T01:45:00.000Z',
    )
  })

  it('reads an hour named once as it is, whatever it was filled from', () => {
    expect(toInstant('2019-10-22T06:00', '2019-10-27T01:30:00.000Z')).toBe(
      '2019-10-22T04:00:00.000Z',
    )
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

  /** 23:00Z on the 21st is already the 22nd in Paris. */
  it('reads the date alone in French time', () => {
    expect(formatDate('2019-10-21T23:00:00.000Z')).toBe('22/10/2019')
  })
})

describe('what a typed hour is read as, under its field', () => {
  it('says nothing of an ordinary hour, which the field already says', () => {
    expect(readBack('2019-10-22T06:00')).toBeUndefined()
  })

  it('says nothing of the hour October names twice, which reads back as typed', () => {
    expect(readBack('2019-10-27T02:30')).toBeUndefined()
  })

  it('says the hour taken for one the change of clock skips', () => {
    expect(readBack('2019-03-31T02:30')).toBe(
      'Heure sautée par le passage à l’heure d’été : 31/03/2019 03:30 retenu.',
    )
  })

  it('says nothing of a field left empty', () => {
    expect(readBack('')).toBeUndefined()
  })
})

describe('when something happened, seen from the instant being read', () => {
  it('is the hour alone on the same day in Paris', () => {
    expect(formatSince('2019-10-22T04:00:00.000Z', '2019-10-22T21:00:00.000Z')).toBe('à 06:00')
  })

  /** 23:00 UTC is already the next day in Paris. */
  it('carries its day when Paris has turned the page', () => {
    expect(formatSince('2019-10-22T21:00:00.000Z', '2019-10-22T23:00:00.000Z')).toBe(
      'le 22/10 à 23:00',
    )
  })
})

describe('a period in a sentence', () => {
  /** Paris is UTC+1 in winter: `T23:00Z` is midnight there. */
  const between = (from: string, to: string) => formatPeriod({ from, to })

  it('says the days of a period of several, in one month', () => {
    // 21 January 16:00 to 27 January 16:00, French time.
    expect(between('2020-01-21T15:00:00.000Z', '2020-01-27T15:00:00.000Z')).toBe(
      'du 21 au 27 janvier 2020',
    )
  })

  it('names both months when it runs across two', () => {
    expect(between('2020-01-28T11:00:00.000Z', '2020-02-03T11:00:00.000Z')).toBe(
      'du 28 janvier au 3 février 2020',
    )
  })

  it('names both years when it runs across two', () => {
    expect(between('2019-12-28T11:00:00.000Z', '2020-01-03T11:00:00.000Z')).toBe(
      'du 28 décembre 2019 au 3 janvier 2020',
    )
  })

  /** Running to midnight on the 28th covers nothing of the 28th. */
  it('ends on the day before an end at midnight', () => {
    expect(between('2020-01-20T23:00:00.000Z', '2020-01-27T23:00:00.000Z')).toBe(
      'du 21 au 27 janvier 2020',
    )
  })

  it('says one day for a day from midnight to midnight', () => {
    expect(between('2026-02-11T23:00:00.000Z', '2026-02-12T23:00:00.000Z')).toBe(
      'le 12 février 2026',
    )
  })

  /** 29 March 2026 lasts 23 hours, and is still one day. */
  it('says one day for the day the clocks go forward', () => {
    expect(between('2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z')).toBe('le 29 mars 2026')
  })

  it('writes the first of the month as French does', () => {
    expect(between('2020-02-01T11:00:00.000Z', '2020-02-05T11:00:00.000Z')).toBe(
      'du 1er au 5 février 2020',
    )
  })

  it('says the hours of a period shorter than a day', () => {
    expect(between('2020-02-07T11:00:00.000Z', '2020-02-07T12:30:00.000Z')).toBe(
      'le 7 février 2020 de 12 h à 13 h 30',
    )
  })

  it('says midnight for a short period that runs to it', () => {
    expect(between('2020-02-07T21:00:00.000Z', '2020-02-07T23:00:00.000Z')).toBe(
      'le 7 février 2020 de 22 h à minuit',
    )
  })

  it('says both days of a short period across midnight', () => {
    expect(between('2020-02-07T21:00:00.000Z', '2020-02-08T03:00:00.000Z')).toBe(
      'du 7 février 22 h au 8 février 2020 4 h',
    )
  })

  /** The day is Paris's: 23:00Z on the 21st is already the 22nd there. */
  it('reads the day in French time', () => {
    expect(between('2019-10-21T23:00:00.000Z', '2019-10-22T04:00:00.000Z')).toBe(
      'le 22 octobre 2019 de 1 h à 6 h',
    )
  })
})

describe('how long a period lasts', () => {
  it('counts whole days', () => {
    const period = { from: '2026-10-11T22:00:00.000Z', to: '2026-10-12T22:00:00.000Z' }
    expect(formatDuration(period)).toBe('1 jour')
  })

  it('adds the hours and minutes past the days', () => {
    expect(
      formatDuration({ from: '2019-10-22T04:00:00.000Z', to: '2019-10-24T10:00:00.000Z' }),
    ).toBe('2 jours 6 h')
    expect(
      formatDuration({ from: '2019-10-22T04:00:00.000Z', to: '2019-10-22T22:30:00.000Z' }),
    ).toBe('18 h 30')
  })

  it('reads days on a Paris clock across the October change', () => {
    // Midnight on the 26th to midnight on the 29th in Paris: 73 hours apart.
    const period = { from: '2019-10-25T22:00:00.000Z', to: '2019-10-28T23:00:00.000Z' }
    expect(formatDuration(period)).toBe('3 jours')
  })
})

describe('the parts of an instant a ruler reads', () => {
  /** 23:00Z on the 21st is midnight of the 22nd in Paris, in summer time. */
  it('reads the hour of Paris, midnight as 0', () => {
    expect(hourOf('2019-10-21T22:00:00.000Z')).toBe(0)
    expect(hourOf('2019-10-22T04:00:00.000Z')).toBe(6)
  })

  it('writes the day and the month of Paris', () => {
    expect(formatDay('2019-10-21T23:00:00.000Z')).toBe('22/10')
  })
})

describe('where a field of hours may start', () => {
  /** 08:30:45Z is 10:30:45 in Paris: 10:30 would be before it. */
  it('is the next whole minute of an instant that falls between two', () => {
    expect(toLocalInputFrom('2024-10-17T08:30:45.000Z')).toBe('2024-10-17T10:31')
  })

  it('is the instant itself when it falls on a whole minute', () => {
    expect(toLocalInputFrom('2024-10-17T08:30:00.000Z')).toBe('2024-10-17T10:30')
  })
})

describe('an instant read as a number', () => {
  it('is the epoch it names, whatever its precision', () => {
    expect(epochOf('2019-10-22T06:00:00Z')).toBe(Date.parse('2019-10-22T06:00:00Z'))
    expect(epochOf('2019-10-22T06:00:00.500Z')).toBe(Date.parse('2019-10-22T06:00:00.500Z'))
  })

  it('reads the same twice, the second time from what it kept', () => {
    expect(epochOf('2019-10-27T01:30:00.000Z')).toBe(epochOf('2019-10-27T01:30:00.000Z'))
  })
})
