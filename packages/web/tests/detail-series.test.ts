import { describe, expect, it } from 'vitest'

import {
  UNCOLOURED,
  floodMarksOf,
  formatValue,
  ladderOf,
  seriesOf,
  valueAt,
  watchedQuantity,
} from '../src/detail/series.ts'
import { aMeasure, aThresholdOf, at } from './support/content.ts'

describe('the quantity a station is watched on', () => {
  it('is the one its alert ladder bears on', () => {
    const thresholds = [
      aThresholdOf({ stationId: 4, quantity: 'flow' }),
      aThresholdOf({ stationId: 4, id: 2, quantity: 'level', nature: 'flood-mark' }),
    ]

    expect(watchedQuantity(thresholds, 4)).toBe('flow')
  })

  it('is the water level when the station carries only marks of past floods', () => {
    const marks = [aThresholdOf({ stationId: 4, quantity: 'flow', nature: 'flood-mark' })]

    expect(watchedQuantity(marks, 4)).toBe('level')
  })

  it('is the water level when the only ladder belongs to another station', () => {
    expect(watchedQuantity([aThresholdOf({ stationId: 7 })], 4)).toBe('level')
  })

  it('is the richest of the two when the ladder bears on both', () => {
    const both = [
      aThresholdOf({ stationId: 4, id: 1, quantity: 'level' }),
      aThresholdOf({ stationId: 4, id: 2, quantity: 'flow' }),
      aThresholdOf({ stationId: 4, id: 3, quantity: 'flow' }),
    ]

    expect(watchedQuantity(both, 4)).toBe('flow')
  })
})

describe('the series a chart draws', () => {
  const measures = [
    aMeasure(4, '2019-10-22T06:00:00.000Z', 1.2),
    aMeasure(4, '2019-10-22T07:00:00.000Z', 2.4),
  ]

  it('keeps the measures of that source, oldest first', () => {
    const mixed = [aMeasure(7, '2019-10-22T06:30:00.000Z', 9), ...[...measures].reverse()]

    expect(seriesOf(mixed, 4, 'flow').points.map((one) => one.value)).toEqual([1.2, 2.4])
  })

  /** A station measured on two quantities would draw its levels in m³/s. */
  it('drops the measures of another quantity the same station also carries', () => {
    const both = [...measures, aMeasure(4, '2019-10-22T06:30:00.000Z', 0.4, 'level')]

    expect(seriesOf(both, 4, 'flow')).toEqual({
      quantity: 'flow',
      unit: 'm³/s',
      points: [
        { at: at('2019-10-22T06:00:00.000Z'), value: 1.2 },
        { at: at('2019-10-22T07:00:00.000Z'), value: 2.4 },
      ],
    })
  })

  it('is empty when the station measured nothing in the period', () => {
    expect(seriesOf([aMeasure(7, '2019-10-22T06:00:00.000Z', 9)], 4, 'level')).toEqual({
      quantity: 'level',
      unit: 'm',
      points: [],
    })
  })
})

describe('the value shown beside the curve', () => {
  const points = [
    { at: at('2019-10-22T06:00:00.000Z'), value: 1.2 },
    { at: at('2019-10-22T08:00:00.000Z'), value: 2.4 },
  ]

  it('is the last measure taken before the cursor', () => {
    expect(valueAt(points, at('2019-10-22T07:00:00.000Z'))).toEqual(points[0])
    expect(valueAt(points, at('2019-10-22T09:00:00.000Z'))).toEqual(points[1])
  })

  /**
   * Jumping to a crossing puts the cursor on the instant of a measure: read
   * one measure late, the bubble would contradict the colour of the map.
   */
  it('is the measure taken at the cursor itself, and not the one before', () => {
    expect(valueAt(points, at('2019-10-22T08:00:00.000Z'))).toEqual(points[1])
  })

  it('is nothing before the first measure of the period', () => {
    expect(valueAt(points, at('2019-10-22T05:00:00.000Z'))).toBeUndefined()
  })
})

describe('a measured value, as the interface writes it', () => {
  it('is written in French, with a comma', () => {
    expect(formatValue(3.07)).toBe('3,07')
    expect(formatValue(-0.42)).toBe('-0,42')
  })

  /** Aquasys gives a flow to the centilitre, and floats add digits of their own. */
  it('stops at two decimals, and rounds rather than truncates', () => {
    expect(formatValue(3.0700000000000003)).toBe('3,07')
    expect(formatValue(2.345)).toBe('2,35')
    expect(formatValue(2.344)).toBe('2,34')
  })

  it('writes a whole number whole', () => {
    expect(formatValue(14)).toBe('14')
  })
})

describe('the ladder drawn behind the curve', () => {
  const thresholds = [
    aThresholdOf({ stationId: 4, value: 7 }),
    aThresholdOf({ stationId: 4, value: 3 }),
    aThresholdOf({ stationId: 4, quantity: 'level', value: 1.2 }),
    aThresholdOf({ stationId: 4, nature: 'flood-mark', value: 9 }),
    aThresholdOf({ stationId: 7, value: 5 }),
  ]

  /** Lowest rung first, whatever order the replay froze the thresholds in. */
  it('is the alert thresholds of that station, on the quantity drawn', () => {
    expect(ladderOf(thresholds, 4, 'flow')).toEqual([
      { value: 3, colour: '#ffff00' },
      { value: 7, colour: '#ffff00' },
    ])
  })

  /** Two fifths of the parc's thresholds carry no colour, and an undrawn rung says nothing. */
  it('gives a rung the source left uncoloured one of its own', () => {
    expect(ladderOf([aThresholdOf({ stationId: 4, color: null })], 4, 'flow')).toEqual([
      { value: 2.8, colour: UNCOLOURED },
    ])
  })

  /** Its values fall as the situation worsens: drawn as rungs, it reads inverted. */
  it('leaves out a drought scale', () => {
    const drought = [aThresholdOf({ stationId: 4, nature: 'drought-threshold', value: 0.3 })]

    expect(ladderOf(drought, 4, 'flow')).toEqual([])
  })
})

describe('the marks of past floods the curve leaves out', () => {
  it('are counted, so the bubble can say the station carries them', () => {
    const thresholds = [
      aThresholdOf({ stationId: 4, nature: 'flood-mark' }),
      aThresholdOf({ stationId: 4, nature: 'flood-mark', quantity: 'level' }),
      aThresholdOf({ stationId: 4 }),
      aThresholdOf({ stationId: 7, nature: 'flood-mark' }),
    ]

    expect(floodMarksOf(thresholds, 4)).toBe(2)
  })

  /** A station low on water carries a scale that is neither a ladder nor a mark. */
  it('are none for a drought scale', () => {
    const drought = [aThresholdOf({ stationId: 4, nature: 'drought-threshold' })]

    expect(floodMarksOf(drought, 4)).toBe(0)
  })
})
