import { describe, expect, it } from 'vitest'

import {
  NONE,
  barWidthOf,
  barsLabel,
  framedIn,
  readAt,
  statesAt,
} from '../src/detail/rain-chart.ts'
import type { Step } from '../src/rain.ts'
import { at } from './support/content.ts'

const steps: Step[] = [
  { from: at('2019-10-22T05:00:00.000Z'), at: at('2019-10-22T06:00:00.000Z'), millimetres: 3 },
  { from: at('2019-10-22T06:00:00.000Z'), at: at('2019-10-22T07:00:00.000Z'), millimetres: 0 },
  { from: at('2019-10-22T07:00:00.000Z'), at: at('2019-10-22T08:00:00.000Z'), millimetres: 9 },
]

describe('the bar the reading is standing on', () => {
  it('is the last measure taken at or before the cursor', () => {
    expect(statesAt(steps, at('2019-10-22T07:30:00.000Z'))).toEqual(['past', 'read', 'ahead'])
  })

  /**
   * The same measure `rainAt` counts the total up to, so the figure in the
   * header and the bar picked out under it are never two different measures.
   */
  it('is the measure itself on the instant it was taken', () => {
    expect(statesAt(steps, at('2019-10-22T07:00:00.000Z'))).toEqual(['past', 'read', 'ahead'])
  })

  it('stands on none before the gauge first looked', () => {
    expect(statesAt(steps, at('2019-10-22T00:00:00.000Z'))).toEqual(['ahead', 'ahead', 'ahead'])
  })

  it('stands on the last one once the period is over', () => {
    expect(statesAt(steps, at('2019-10-22T23:00:00.000Z'))).toEqual(['past', 'past', 'read'])
  })
})

describe('the rank of the bar the reading stands on', () => {
  it('is nothing at all before the gauge first looked', () => {
    expect(readAt(steps, at('2019-10-22T00:00:00.000Z'))).toBe(NONE)
  })

  it('is the rank `statesAt` marks as read', () => {
    const rank = readAt(steps, at('2019-10-22T07:30:00.000Z'))

    expect(statesAt(steps, at('2019-10-22T07:30:00.000Z'))[rank]).toBe('read')
  })
})

/** uPlot reads a time scale in seconds, where a cursor counts milliseconds. */
const seconds = (iso: string) => at(iso) / 1000

describe('what a window of the chart shows', () => {
  const whole = {
    min: seconds('2019-10-22T00:00:00.000Z'),
    max: seconds('2019-10-23T00:00:00.000Z'),
  }

  it('sums the rain measure by measure', () => {
    expect(framedIn(steps, whole).totals).toEqual([3, 3, 12])
  })

  /** What the curve says is how much fell over what the reader is looking at. */
  it('starts the total from the first measure inside the window', () => {
    const late = { min: seconds('2019-10-22T06:30:00.000Z'), max: whole.max }

    expect(framedIn(steps, late).totals).toEqual([null, 0, 9])
  })

  it('counts a measure taken on either edge of the window', () => {
    const edges = {
      min: seconds('2019-10-22T06:00:00.000Z'),
      max: seconds('2019-10-22T07:00:00.000Z'),
    }

    expect(framedIn(steps, edges).totals).toEqual([3, 3, null])
  })

  it('tops the bars a tenth above the heaviest inside the window, and the total at its end', () => {
    expect(framedIn(steps, whole)).toMatchObject({ rainTop: 9 * 1.1, totalTop: 12 })
  })

  /** A daily measure covers the whole of a short window, and has to fit in it. */
  it('tops the bars on a measure the window crosses without holding its end', () => {
    const inside = {
      min: seconds('2019-10-22T07:15:00.000Z'),
      max: seconds('2019-10-22T07:45:00.000Z'),
    }

    expect(framedIn(steps, inside)).toEqual({
      totals: [null, null, null],
      rainTop: 9 * 1.1,
      totalTop: 1,
    })
  })

  /** Neither scale may collapse on zero, which would draw nothing at all. */
  it('tops both scales at one millimetre when the window holds no rain', () => {
    const dry = {
      min: seconds('2019-10-22T06:30:00.000Z'),
      max: seconds('2019-10-22T06:45:00.000Z'),
    }

    expect(framedIn(steps, dry)).toEqual({ totals: [null, null, null], rainTop: 1, totalTop: 1 })
  })

  it('does not drift on a sum of tenths', () => {
    const tenths = steps.map((one) => ({ ...one, millimetres: 0.1 }))

    expect(framedIn(tenths, whole).totals).toEqual([0.1, 0.2, 0.3])
  })
})

describe('what the legend calls the bars', () => {
  it('names the step the gauge measured at', () => {
    expect(barsLabel(60)).toBe('Cumul pluvio / 1 heure')
    expect(barsLabel(1440)).toBe('Cumul pluvio / 24 heures')
  })

  it('names no step a gauge never gave', () => {
    expect(barsLabel(undefined)).toBe('Cumul pluvio')
  })
})

describe('the width a bar of the chart is painted at', () => {
  it('is its own span, however narrow, so bars side by side never cover each other', () => {
    expect(barWidthOf(1.4, 16)).toBe(1.4)
    expect(barWidthOf(40, 16)).toBe(40)
  })

  it('never goes under one device pixel', () => {
    expect(barWidthOf(0.3, 16)).toBe(1)
  })

  it('falls back on the floor for a measure with no span', () => {
    expect(barWidthOf(0, 16)).toBe(16)
  })
})
