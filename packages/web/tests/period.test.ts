import { describe, expect, it } from 'vitest'

import { endOnOpening, hoursBetween, lengthWarning, periodOf } from '../src/creation/period.ts'

describe('the period a form sends', () => {
  it('is the French hour the agent picked, as the instant it names', () => {
    expect(periodOf('2019-10-22T06:00', '2019-10-23T06:00')).toEqual({
      period: { from: '2019-10-22T04:00:00.000Z', to: '2019-10-23T04:00:00.000Z' },
    })
  })

  it('refuses an end before its start', () => {
    expect(periodOf('2019-10-23T06:00', '2019-10-22T06:00')).toEqual({
      refusal: 'La période va du début vers la fin.',
    })
  })

  it('refuses an end equal to its start', () => {
    expect(periodOf('2019-10-22T06:00', '2019-10-22T06:00')).toHaveProperty('refusal')
  })

  it('refuses an end past the present, which nothing has measured yet', () => {
    const now = Date.parse('2026-11-04T12:00:00.000Z')
    expect(periodOf('2026-11-04T10:00', '2026-11-04T14:00', now)).toEqual({
      refusal: 'La fin ne peut pas dépasser l’heure actuelle.',
    })
    expect(periodOf('2026-11-04T10:00', '2026-11-04T13:00', now)).toHaveProperty('period')
  })

  it('refuses what is not two instants', () => {
    expect(periodOf('', '2019-10-22T06:00')).toHaveProperty('refusal')
    expect(periodOf('2019-10-22T06:00', '')).toHaveProperty('refusal')
  })
})

describe('what the form says of a long period', () => {
  it('warns past a month', () => {
    expect(lengthWarning('2019-10-01T00:00', '2019-11-02T00:00')).toContain('plus d’un mois')
  })

  it('says nothing of a month or less', () => {
    expect(lengthWarning('2019-12-01T00:00', '2020-01-01T00:00')).toBeUndefined()
  })
})

describe('the duration a form shows', () => {
  it('counts the hours a replay would cover', () => {
    expect(hoursBetween('2019-10-22T06:00', '2019-10-23T06:00')).toBe(24)
  })

  it('counts the clock change in, since the replay covers it too', () => {
    // The night the clocks go back is twenty-five hours long.
    expect(hoursBetween('2019-10-26T12:00', '2019-10-27T12:00')).toBe(25)
  })

  it('counts nothing it cannot read', () => {
    expect(hoursBetween('', '2019-10-23T06:00')).toBeUndefined()
  })
})

describe('the end as it is opened', () => {
  /** A picker left empty opens on today, years from the flood replayed. */
  it('is the start, when it holds nothing yet', () => {
    expect(endOnOpening('2020-01-26T08:00', '')).toBe('2020-01-26T08:00')
  })

  it('is what it holds, once it holds something', () => {
    expect(endOnOpening('2020-01-26T08:00', '2020-01-27T08:00')).toBe('2020-01-27T08:00')
  })

  it('is nothing while the start is not an hour', () => {
    expect(endOnOpening('', '')).toBe('')
  })
})
