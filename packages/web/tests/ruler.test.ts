import { describe, expect, it } from 'vitest'

import { ticksOf, trackWidthOf } from '../src/tracks/ruler.ts'

describe('the ticks of the ruler', () => {
  it('names every hour of a day, from its first, and the day on its midnight', () => {
    const ticks = ticksOf({ from: '2019-10-21T22:00:00.000Z', to: '2019-10-22T22:00:00.000Z' })

    expect(ticks).toHaveLength(24)
    expect(ticks[0]).toMatchObject({ fraction: 0, label: '22/10', odd: false, minor: false })
    expect(ticks[4]).toMatchObject({ label: '04:00', odd: false, minor: false })
    expect(ticks[6]).toMatchObject({ label: '06:00', odd: false, minor: true })
    expect(ticks[23]).toMatchObject({ label: '23:00', odd: true, minor: true })
  })

  it('starts on the first full hour of a period that does not', () => {
    const ticks = ticksOf({ from: '2019-10-22T05:30:00.000Z', to: '2019-10-22T09:30:00.000Z' })

    expect(ticks.map((one) => one.label)).toEqual(['08:00', '09:00', '10:00', '11:00'])
    expect(ticks[0]?.fraction).toBe(0.125)
  })

  it('takes a longer step over a longer period', () => {
    const ticks = ticksOf({ from: '2019-10-21T22:00:00.000Z', to: '2019-10-23T22:00:00.000Z' })

    expect(ticks).toHaveLength(24)
    expect(ticks.slice(0, 3).map((one) => one.label)).toEqual(['22/10', '02:00', '04:00'])
  })

  it('names the day on every midnight of a period of a few days', () => {
    const ticks = ticksOf({ from: '2019-10-21T22:00:00.000Z', to: '2019-10-24T22:00:00.000Z' })

    expect(ticks.filter((one) => !one.label.includes(':')).map((one) => one.label)).toEqual([
      '22/10',
      '23/10',
      '24/10',
    ])
  })

  /** Counted from the first tick, a midnight would be one whose label gives way. */
  it('keeps the label of a midnight on a period that starts elsewhere', () => {
    const ticks = ticksOf({ from: '2019-10-21T12:00:00.000Z', to: '2019-10-24T12:00:00.000Z' })
    const midnights = ticks.filter((one) => !one.label.includes(':'))

    expect(midnights.map((one) => one.label)).toEqual(['22/10', '23/10', '24/10'])
    expect(midnights.every((one) => !one.odd && !one.minor)).toBe(true)
  })

  /**
   * On 2019-10-27, Paris goes back from 03:00 to 02:00: the day holds 25 hours,
   * and 02:00 happens twice. Counted from the start, every tick after it would
   * name the hour before its own.
   */
  it('names the hours of the day the clocks go back as Paris reads them', () => {
    const ticks = ticksOf({ from: '2019-10-26T22:00:00.000Z', to: '2019-10-27T23:00:00.000Z' })

    expect(ticks.map((one) => one.label)).toEqual([
      '27/10',
      '02:00',
      '02:00',
      '04:00',
      '06:00',
      '08:00',
      '10:00',
      '12:00',
      '14:00',
      '16:00',
      '18:00',
      '20:00',
      '22:00',
    ])
  })

  it('names days on a period of weeks, on the midnights of Paris', () => {
    const ticks = ticksOf({ from: '2019-09-30T22:00:00.000Z', to: '2019-11-30T23:00:00.000Z' })

    expect(ticks.length).toBeLessThanOrEqual(24)
    expect(ticks.slice(0, 3).map((one) => one.label)).toEqual(['01/10', '08/10', '15/10'])
  })

  it('holds nothing for a period that does not run forward', () => {
    expect(ticksOf({ from: '2019-10-22T06:00:00.000Z', to: '2019-10-22T06:00:00.000Z' })).toEqual(
      [],
    )
  })
})

describe('the width of the lanes where they scroll', () => {
  it('gives a day an hour every 120 pixels, as the mockup draws it', () => {
    expect(trackWidthOf({ from: '2019-10-21T22:00:00.000Z', to: '2019-10-22T22:00:00.000Z' })).toBe(
      2880,
    )
  })

  it('gives a fortnight a day every 120 pixels rather than an hour', () => {
    expect(trackWidthOf({ from: '2026-02-07T11:30:00.000Z', to: '2026-02-23T11:30:00.000Z' })).toBe(
      16 * 120,
    )
  })

  it('draws a few hours narrower than a day', () => {
    expect(trackWidthOf({ from: '2019-10-22T06:00:00.000Z', to: '2019-10-22T12:00:00.000Z' })).toBe(
      6 * 120,
    )
  })
})
