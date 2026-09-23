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
   * Spacing exists because a frame costs a file. A bar costs nothing of the
   * sort, and dropping one would drop a measure — which is the one thing a lane
   * of bars is there to show.
   */
  it('draws every bar of a lane of bars, however close together they sit', () => {
    const marks = hourly(24)

    expect(drawnMarks(laneOf(marks, { bars: true }), MIN_GAP)).toHaveLength(24)
    expect(drawnMarks(laneOf(marks), MIN_GAP).length).toBeLessThan(24)
  })

  /** The order `barsOf` settled is the order they are drawn in, untouched. */
  it('leaves a lane of bars in the order it was given', () => {
    const marks = hourly(4)

    expect(drawnMarks(laneOf(marks, { bars: true }), MIN_GAP)).toEqual(marks)
  })

  it('still spaces a lane of crossings out, and still tiles a strip', () => {
    const marks = hourly(24)

    expect(drawnMarks(laneOf(marks), MIN_GAP).length).toBeLessThan(marks.length)
    // Tiled: every frame but the last runs up to the one that follows it.
    const strip = drawnMarks(laneOf(marks, { filmstrip: true }), MIN_GAP)
    expect(strip.slice(0, -1).map((one) => one.left + one.width)).toEqual(
      strip.slice(1).map((one) => one.left),
    )
  })
})
