import { describe, expect, it } from 'vitest'

import { boundsWith, figureLabels, hourLabels, plotted, windowAround } from '../src/detail/chart.ts'
import { seriesOf } from '../src/detail/series.ts'
import { aMeasure, at } from './support/content.ts'

/** uPlot reads a time scale in seconds, where a cursor counts milliseconds. */
const seconds = (iso: string) => at(iso) / 1000

describe('the window the curve shows', () => {
  it('is the three hours on each side of the instant, in seconds', () => {
    expect(windowAround(at('2019-10-22T12:00:00.000Z'))).toEqual({
      min: seconds('2019-10-22T09:00:00.000Z'),
      max: seconds('2019-10-22T15:00:00.000Z'),
    })
  })

  /** The bar that marks the instant is drawn at the middle, and works nothing out. */
  it('puts the instant at the middle, which is where the bar is drawn', () => {
    const instant = at('2019-10-22T14:41:00.000Z')
    const window = windowAround(instant)

    expect((window.min + window.max) / 2).toBe(instant / 1000)
  })

  /** The empty half of the frame is what says the period stops there. */
  it('does not stop at the edges of the period', () => {
    expect(windowAround(at('2019-10-22T00:00:00.000Z')).min).toBe(
      seconds('2019-10-21T21:00:00.000Z'),
    )
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
    { value: 3, colour: '#ffff00' },
    { value: 7, colour: '#ff0000' },
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
    expect(hourLabels([seconds('2019-10-22T06:00:00.000Z')])).toEqual(['08:00'])
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
