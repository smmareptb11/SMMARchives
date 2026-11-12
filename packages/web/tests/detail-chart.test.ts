import { describe, expect, it } from 'vitest'

import {
  axisWidth,
  boundsWith,
  figureLabels,
  hourLabels,
  plotted,
  SPANS,
  STATION_SPAN,
  windowOf,
} from '../src/detail/chart.ts'
import { seriesOf } from '../src/detail/series.ts'
import { aMeasure, at, period } from './support/content.ts'

/** uPlot reads a time scale in seconds, where a cursor counts milliseconds. */
const seconds = (iso: string) => at(iso) / 1000

describe('the window a chart shows', () => {
  it('opens a station on the three hours on each side of the instant, in seconds', () => {
    expect(windowOf(STATION_SPAN, at('2019-10-22T12:00:00.000Z'), period)).toEqual({
      min: seconds('2019-10-22T09:00:00.000Z'),
      max: seconds('2019-10-22T15:00:00.000Z'),
    })
  })

  /** The reader finds the instant at the middle of the frame, whatever the span. */
  it('puts the instant at the middle of every span', () => {
    const instant = at('2019-10-22T14:41:00.000Z')

    for (const { value } of SPANS.filter((one) => one.value !== 'all')) {
      const window = windowOf(value, instant, period)
      expect((window.min + window.max) / 2).toBe(instant / 1000)
    }
  })

  it('is as long as the span picked', () => {
    const span = SPANS.find((one) => one.label === '1h')?.value
    if (span === undefined || span === 'all') throw new Error('no span of one hour')

    expect(windowOf(span, at('2019-10-22T12:00:00.000Z'), period)).toEqual({
      min: seconds('2019-10-22T11:30:00.000Z'),
      max: seconds('2019-10-22T12:30:00.000Z'),
    })
  })

  it('is the period, wherever the instant is, over all of it', () => {
    expect(windowOf('all', at('2019-10-22T14:41:00.000Z'), period)).toEqual({
      min: seconds(period.from),
      max: seconds(period.to),
    })
  })

  /** The empty half of the frame is what says the period stops there. */
  it('does not stop at the edges of the period', () => {
    expect(windowOf(STATION_SPAN, at('2019-10-22T00:00:00.000Z'), period).min).toBe(
      seconds('2019-10-21T21:00:00.000Z'),
    )
  })

  it('offers the spans of the Acycliq widget, in its order', () => {
    expect(SPANS.map((one) => one.label)).toEqual(['1h', '2h', '3h', '6h', '12h', '1j', 'Tout'])
  })
})

describe('the series handed to uPlot', () => {
  it('is the instants and the values apart, in seconds, oldest first', () => {
    const series = seriesOf(
      [aMeasure(4, '2019-10-22T07:00:00.000Z', 2.4), aMeasure(4, '2019-10-22T06:00:00.000Z', 1.2)],
      4,
      'flow',
    )

    expect(plotted(series)).toEqual([
      [seconds('2019-10-22T06:00:00.000Z'), seconds('2019-10-22T07:00:00.000Z')],
      [1.2, 2.4],
    ])
  })

  it('is two empty lists for a station with no measure', () => {
    expect(plotted(seriesOf([], 4, 'level'))).toEqual([[], []])
  })
})

describe('the bounds the scale of values covers', () => {
  const ladder = [
    { value: 3, colour: '#ffff00', label: 'Vigilance', assumed: false },
    { value: 7, colour: '#ff0000', label: 'Alerte', assumed: false },
  ]

  /** A curve far under every threshold has to read as far under them. */
  it('reach every rung of the ladder, however far the curve is from it', () => {
    expect(boundsWith(ladder, 0.4, 0.9)).toEqual([0.4, 7])
  })

  it("are the window's own where the curve runs past the ladder", () => {
    expect(boundsWith(ladder, 1, 12)).toEqual([1, 12])
  })

  it("are the window's own when no ladder is drawn", () => {
    expect(boundsWith([], 1, 12)).toEqual([1, 12])
  })
})

describe('the hours of the time axis', () => {
  /** Carcassonne in October: two hours ahead of UTC. */
  it('are French, wherever the machine reading them is', () => {
    expect(hourLabels([seconds('2019-10-22T06:00:00.000Z')], 3600)).toEqual(['08:00'])
  })

  it('name the day on a midnight, and on a midnight only', () => {
    expect(
      hourLabels(
        [
          seconds('2019-10-22T20:00:00.000Z'),
          seconds('2019-10-22T22:00:00.000Z'),
          seconds('2019-10-22T22:30:00.000Z'),
        ],
        1800,
      ),
    ).toEqual(['22:00', '23/10', '00:30'])
  })

  /** Every tick of a period graduated in days would otherwise read `00:00`. */
  it('are the days once a tick stands for one', () => {
    expect(
      hourLabels([seconds('2019-10-21T22:00:00.000Z'), seconds('2019-10-22T22:00:00.000Z')], 86400),
    ).toEqual(['22/10', '23/10'])
  })
})

describe('the figures of the value axis', () => {
  it('never read two ticks as the same figure', () => {
    expect(figureLabels([0.985, 0.99, 0.995, 1], 0.005)).toEqual([
      '0,985',
      '0,990',
      '0,995',
      '1,000',
    ])
  })

  it('carry no decimal a whole step does not need', () => {
    expect(figureLabels([5, 10, 15], 5)).toEqual(['5', '10', '15'])
  })

  /** uPlot graduates by halves of five as readily as by fives. */
  it('keeps the half a step of two and a half lands on', () => {
    expect(figureLabels([5, 7.5, 10], 2.5)).toEqual(['5,0', '7,5', '10,0'])
  })

  /** A scale uPlot has not ranged yet hands no step, and an axis still reads. */
  it('falls back on whole figures when there is no step', () => {
    expect(figureLabels([3], 0)).toEqual(['3'])
  })
})

describe('the width of the value axis', () => {
  /** Six pixels a character, which is all a test needs of a font. */
  const measure = (text: string) => text.length * 6

  it('keeps its narrowest width while the figures fit in it', () => {
    expect(axisWidth(['0,10', '0,05', '0,00'], measure, 15)).toBe(44)
  })

  /** « 0,0700 » once lost its « 0,0 » to the edge, and read as 700. */
  it('widens to the widest figure, with the room beside it', () => {
    expect(axisWidth(['0,0700', '0,0675', '0,0650'], measure, 15)).toBe(51)
  })

  it('keeps its narrowest width before uPlot has any figure to write', () => {
    expect(axisWidth(null, measure, 15)).toBe(44)
  })
})
