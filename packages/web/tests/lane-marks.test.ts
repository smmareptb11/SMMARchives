import { describe, expect, it } from 'vitest'

import { drawnMarks, placeOf, type Lane, type Mark } from '../src/tracks/lanes.ts'
import { period } from './support/content.ts'

const MIN_GAP = 6

const hourly = (hours: number): Mark[] =>
  Array.from({ length: hours }, (_, index) => {
    const at = `2019-10-22T${String(index).padStart(2, '0')}:00:00.000Z`
    const next = `2019-10-22T${String(index + 1).padStart(2, '0')}:00:00.000Z`

    return { ...placeOf(period, at, next), at }
  })

const laneOf = (marks: Mark[], kind: Partial<Lane> = {}): Lane => ({
  id: 'one',
  label: 'Une',
  marks,
  ...kind,
})

describe('the marks a lane draws', () => {
  /**
   * A bar is a measure: dropping one would drop the one thing a lane of bars
   * is there to show.
   */
  it('draws every bar of a lane of bars, however close together they sit', () => {
    expect(drawnMarks(laneOf(hourly(24), { bars: true }), MIN_GAP)).toHaveLength(24)
  })

  /** The order `barsOf` settled is the order they are drawn in, untouched. */
  it('leaves a lane of bars in the order it was given', () => {
    const marks = hourly(4)

    expect(drawnMarks(laneOf(marks, { bars: true }), MIN_GAP)).toEqual(marks)
  })

  /**
   * Over 48 hours, a crisis that begins twenty minutes after another sits well
   * within the gap samples are spaced by, and it lasts three hours more.
   */
  it('draws every crossing, however soon one begins after the other', () => {
    const days = { from: '2020-01-21T23:00:00.000Z', to: '2020-01-23T23:00:00.000Z' }
    const crossings: Mark[] = [
      { ...placeOf(days, '2020-01-22T11:50:00.000Z', '2020-01-22T11:55:00.000Z'), at: 'a' },
      { ...placeOf(days, '2020-01-22T12:10:00.000Z', '2020-01-22T15:25:00.000Z'), at: 'b' },
    ]

    expect(drawnMarks(laneOf(crossings), MIN_GAP)).toEqual(crossings)
  })

  it('spaces samples out, and tiles a strip', () => {
    const marks = hourly(24)

    expect(drawnMarks(laneOf(marks, { sampled: true }), MIN_GAP).length).toBeLessThan(24)
    // Tiled: every frame but the last runs up to the one that follows it.
    const strip = drawnMarks(laneOf(marks, { filmstrip: true }), MIN_GAP)
    expect(strip.length).toBeLessThan(24)
    expect(strip.slice(0, -1).map((one) => one.left + one.width)).toEqual(
      strip.slice(1).map((one) => one.left),
    )
  })
})
