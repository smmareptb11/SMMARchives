import { describe, expect, it } from 'vitest'

import { crossingsIn, instantToRead, reportsOf, rowsOf } from '../src/events/reports.ts'
import { phaseAt } from '../src/map/reports.ts'
import { drawnMarks, lanesOf } from '../src/tracks/lanes.ts'

import { aCrossing, aReport, aStation, held, period } from './support/content.ts'

describe('the events agents reported', () => {
  it('are the manual events, in the order they happened', () => {
    const late = aReport({ id: 'b', from: '2019-10-22T09:00:00.000Z' })
    const early = aReport({ id: 'a', from: '2019-10-22T07:00:00.000Z' })

    expect(reportsOf([late, aCrossing({ sourceId: 84 }), early])).toEqual([early, late])
  })

  it('leave the count of crossings alone', () => {
    expect(crossingsIn([aCrossing({ sourceId: 84 }), aReport({ id: 'a' })])).toBe(1)
  })
})

describe('the rows of a lane of reports', () => {
  it('keeps on one row what does not overlap', () => {
    expect(
      rowsOf([
        { left: 10, width: 5 },
        { left: 20, width: 5 },
      ]),
    ).toEqual([0, 0])
  })

  it('puts on one row two spans that only touch', () => {
    expect(
      rowsOf([
        { left: 10, width: 5 },
        { left: 15, width: 5 },
      ]),
    ).toEqual([0, 0])
  })

  it('moves an overlapping span down, and back up once there is room', () => {
    expect(
      rowsOf([
        { left: 10, width: 20 },
        { left: 12, width: 0.4 },
        { left: 12, width: 0.4 },
        { left: 25, width: 1 },
        { left: 40, width: 1 },
      ]),
    ).toEqual([0, 1, 2, 1, 0])
  })
})

describe('the lane of reports', () => {
  const twoAtOnce = () =>
    held({
      stations: [aStation(84, 'Trèbes')],
      events: [
        aCrossing({ sourceId: 84 }),
        aReport({ id: 'a', title: 'Route coupée' }),
        aReport({ id: 'b', title: 'Cave inondée' }),
      ],
    })

  it('comes first, apart from the stations', () => {
    const families = lanesOf(twoAtOnce())

    expect(families.map((one) => one.id)).toEqual(['report', 'watercourse'])
    expect(families[0]).toMatchObject({ label: 'Événements saisis', count: 2 })
  })

  it('draws every report, on rows of their own when they happen together', () => {
    const lane = lanesOf(twoAtOnce())[0]?.lanes[0]

    expect(lane?.rows).toBe(2)
    expect(lane?.marks.map((one) => [one.report, one.row, one.label])).toEqual([
      ['a', 0, 'Route coupée'],
      ['b', 1, 'Cave inondée'],
    ])
  })

  it('thins out none of them, however close they are', () => {
    const reports = ['a', 'b', 'c'].map((id, index) =>
      aReport({ id, from: `2019-10-22T06:0${String(index)}:00.000Z` }),
    )
    const lane = lanesOf(held({ events: reports }))[0]?.lanes[0]

    expect(lane === undefined ? [] : drawnMarks(lane, 6)).toHaveLength(3)
  })

  it('is left out of a replay where nobody reported anything', () => {
    const families = lanesOf(held({ stations: [aStation(84, 'Trèbes')] }))

    expect(families.map((one) => one.id)).toEqual(['watercourse'])
  })

  it('gives a report with no end the instant it happened', () => {
    const mark = lanesOf(held({ events: [aReport({ id: 'a' })] }))[0]?.lanes[0]?.marks[0]

    expect(mark).toMatchObject({ left: 25, width: 0.4, at: '2019-10-22T06:00:00.000Z' })
  })

  it('never puts a report on a station it happens to sit beside', () => {
    const families = lanesOf(twoAtOnce())

    expect(families[1]?.lanes[0]?.marks).toHaveLength(1)
  })
})

describe('where the reading goes when a sheet opens', () => {
  it('is the start of the event, where the map shows it under way', () => {
    const span = aReport({
      id: 'a',
      from: '2019-10-22T06:00:00.000Z',
      to: '2019-10-22T08:00:00.000Z',
    })
    const instant = aReport({ id: 'b', from: '2019-10-22T09:00:00.000Z' })

    expect(phaseAt(span, instantToRead(span, period))).toBe('during')
    expect(phaseAt(instant, instantToRead(instant, period))).toBe('during')
  })

  it('stays within the period', () => {
    const before = aReport({ id: 'c', from: '2019-10-21T23:00:00.000Z' })

    expect(instantToRead(before, period)).toBe(Date.parse(period.from))
  })
})
