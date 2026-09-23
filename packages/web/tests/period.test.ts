import { describe, expect, it } from 'vitest'

import { hoursBetween, periodOf } from '../src/creation/period.ts'

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

  it('refuses what is not two instants', () => {
    expect(periodOf('', '2019-10-22T06:00')).toHaveProperty('refusal')
    expect(periodOf('2019-10-22T06:00', '')).toHaveProperty('refusal')
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
