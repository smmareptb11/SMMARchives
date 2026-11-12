import { describe, expect, it } from 'vitest'

import { NIGHT_MUTED, REPORT } from '../src/palette.ts'
import { dotsOf } from '../src/transport/dots.ts'
import { previousMark } from '../src/transport/reading.ts'
import { aCrossing, aReport, at, period } from './support/content.ts'

describe('the events on the ruler', () => {
  it('puts one dot at the start of each event', () => {
    const dots = dotsOf(
      [
        aCrossing({
          sourceId: 1,
          from: '2019-10-22T06:00:00.000Z',
          to: '2019-10-22T12:00:00.000Z',
        }),
      ],
      period,
    )

    expect(dots).toEqual([{ at: at('2019-10-22T06:00:00.000Z'), left: 25, color: '#ffff00' }])
  })

  it('colours a report in the agents’ green, and a crossing with no colour in the grey of the hours', () => {
    const dots = dotsOf([aReport({ id: 'r1' }), aCrossing({ sourceId: 1, color: null })], period)

    expect(dots.map((one) => one.color)).toEqual([REPORT, NIGHT_MUTED])
  })

  it('orders them oldest first, whatever order they came in', () => {
    const dots = dotsOf(
      [
        aReport({ id: 'r1', from: '2019-10-22T18:00:00.000Z' }),
        aCrossing({ sourceId: 1, from: '2019-10-22T06:00:00.000Z' }),
      ],
      period,
    )

    expect(dots.map((one) => one.left)).toEqual([25, 75])
  })

  it('holds a crossing begun before the replay at its start', () => {
    const dots = dotsOf([aCrossing({ sourceId: 1, from: '2019-10-21T20:00:00.000Z' })], period)

    expect(dots).toEqual([{ at: at(period.from), left: 0, color: '#ffff00' }])
  })

  /** The jump lands on the dot, never before the period where no dot is drawn. */
  it('leaves nothing to jump back to from the start of the period', () => {
    const dots = dotsOf([aCrossing({ sourceId: 1, from: '2019-10-21T20:00:00.000Z' })], period)

    expect(
      previousMark(
        dots.map((one) => one.at),
        at(period.from),
      ),
    ).toBeUndefined()
  })
})
