import { describe, expect, it } from 'vitest'

import {
  UNCOLOURED,
  formatValue,
  QUANTITIES,
  ladderIn,
  ladderOf,
  levelSeriesIn,
  levelView,
  openedQuantity,
  quantitiesFor,
  seriesOf,
  valueAt,
  watchedQuantity,
} from '../src/detail/series.ts'
import { aMeasure, aThresholdOf, at } from './support/content.ts'

/** A rung of a ladder, its name and colour kept as it moves. */
const RUNG = { value: 0, colour: '#ffcc00', label: 'Vigilance', assumed: false }

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

  it('is the one its drought ladder bears on when it carries no alert ladder', () => {
    const thresholds = [
      aThresholdOf({ stationId: 4, id: 1, quantity: 'flow', nature: 'drought-threshold' }),
      aThresholdOf({ stationId: 4, id: 2, quantity: 'flow', nature: 'drought-threshold' }),
      aThresholdOf({ stationId: 4, id: 1, quantity: 'level', nature: 'flood-mark' }),
    ]

    expect(watchedQuantity(thresholds, 4)).toBe('flow')
  })

  it('is the one its alert ladder bears on, over a richer drought ladder', () => {
    const thresholds = [
      aThresholdOf({ stationId: 4, id: 1, quantity: 'level' }),
      aThresholdOf({ stationId: 4, id: 1, quantity: 'flow', nature: 'drought-threshold' }),
      aThresholdOf({ stationId: 4, id: 2, quantity: 'flow', nature: 'drought-threshold' }),
    ]

    expect(watchedQuantity(thresholds, 4)).toBe('level')
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
      { value: 3, colour: '#ffff00', label: 'Vigilance', assumed: false },
      { value: 7, colour: '#ffff00', label: 'Vigilance', assumed: false },
    ])
  })

  /** Two fifths of the parc's thresholds carry no colour, and an undrawn rung says nothing. */
  it('gives a rung the source left uncoloured one of its own', () => {
    expect(ladderOf([aThresholdOf({ stationId: 4, color: null })], 4, 'flow')).toEqual([
      { value: 2.8, colour: UNCOLOURED, label: 'Vigilance', assumed: false },
    ])
  })

  /** Its values fall as the situation worsens: drawn as rungs, it reads inverted. */
  it('leaves out a drought scale', () => {
    const drought = [aThresholdOf({ stationId: 4, nature: 'drought-threshold', value: 0.3 })]

    expect(ladderOf(drought, 4, 'flow')).toEqual([])
  })
})

describe("the quantity a station's chart opens on", () => {
  it('is the one the station is watched on', () => {
    const thresholds = [aThresholdOf({ stationId: 4, quantity: 'flow' })]

    expect(openedQuantity(thresholds, 4)).toBe('flow')
  })

  /** A chart opened on a quantity it offers no choice of would lose it at the first click. */
  it('is the level when the ladder bears on a quantity the chart does not offer', () => {
    const thresholds = [aThresholdOf({ stationId: 4, quantity: 'rainfall' })]

    expect(openedQuantity(thresholds, 4)).toBe('level')
  })

  it('is always one the chart offers', () => {
    for (const quantity of ['level', 'flow', 'rainfall'] as const) {
      const opened = openedQuantity([aThresholdOf({ stationId: 4, quantity })], 4)
      expect(QUANTITIES.map((one) => one.value)).toContain(opened)
    }
  })
})

describe("the quantities a station's chart offers", () => {
  const measured = seriesOf([aMeasure(4, '2019-10-22T08:00:00.000Z', 1.2)], 4, 'flow')
  const empty = seriesOf([], 4, 'flow')
  const unavailable = (read: Parameters<typeof quantitiesFor>[0]) =>
    quantitiesFor(read).map((one) => [one.value, one.unavailable])

  it('are all offered when each holds a measure', () => {
    expect(unavailable({ level: measured, flow: measured })).toEqual([
      ['level', undefined],
      ['flow', undefined],
    ])
  })

  it('grey out the flow when the period holds none, and say so', () => {
    expect(unavailable({ level: measured, flow: empty })).toEqual([
      ['level', undefined],
      ['flow', 'Aucune mesure de débit dans la période'],
    ])
  })

  it('grey out the level when the period holds none, and say so', () => {
    expect(unavailable({ level: empty, flow: measured })).toEqual([
      ['level', 'Aucune mesure de hauteur dans la période'],
      ['flow', undefined],
    ])
  })

  /** Being read, or failing to be, is not having measured nothing. */
  it('offer a quantity not read yet', () => {
    expect(unavailable({ level: undefined, flow: undefined })).toEqual([
      ['level', undefined],
      ['flow', undefined],
    ])
  })
})

describe('the datum a level is shown from', () => {
  it('is the one picked, moved by the NGF altitude of the gauge zero', () => {
    expect(levelView('gauge', 'ngf', 56.148)).toEqual({ datum: 'ngf', shift: 56.148 })
    expect(levelView('ngf', 'gauge', 127.55)).toEqual({ datum: 'gauge', shift: -127.55 })
  })

  it('is the one measured from, unmoved, when it is the one picked', () => {
    expect(levelView('gauge', 'gauge', 56.148)).toEqual({ datum: 'gauge', shift: 0 })
    expect(levelView('ngf', 'ngf', 127.55)).toEqual({ datum: 'ngf', shift: 0 })
  })

  it('is the one measured from, unmoved, when the gauge zero has no known altitude', () => {
    expect(levelView('gauge', 'ngf', null)).toEqual({ datum: 'gauge', shift: 0 })
    expect(levelView('ngf', 'gauge', null)).toEqual({ datum: 'ngf', shift: 0 })
  })
})

describe('a level measured from the gauge zero', () => {
  const level = {
    quantity: 'level' as const,
    unit: 'm',
    points: [
      { at: at('2019-10-22T06:00:00.000Z'), value: 1.44 },
      { at: at('2019-10-22T07:00:00.000Z'), value: 0.1 },
    ],
  }
  const inNgf = levelView('gauge', 'ngf', 56.148)

  it('is every measure raised by the altitude of the gauge zero, in metres NGF', () => {
    expect(levelSeriesIn(level, inNgf)).toEqual({
      quantity: 'level',
      unit: 'm NGF',
      points: [
        { at: at('2019-10-22T06:00:00.000Z'), value: 57.588 },
        { at: at('2019-10-22T07:00:00.000Z'), value: 56.248 },
      ],
    })
  })

  /** 0.1 + 56.148 is 56.248000000000005 in floating point. */
  it('is rounded to the millimetre, as the widget rounds it', () => {
    expect(levelSeriesIn(level, inNgf).points[1]?.value).toBe(56.248)
  })

  it('raises the ladder it is read against by as much, colours kept', () => {
    expect(ladderIn([{ ...RUNG, value: 2.5 }], inNgf)).toEqual([{ ...RUNG, value: 58.648 }])
  })
})

/**
 * Badens, measured in metres NGF and given no altitude of its gauge zero: its
 * level reads as measured, and in no other datum.
 */
describe('a level measured in metres NGF from a gauge zero of unknown altitude', () => {
  const level = {
    quantity: 'level' as const,
    unit: 'm',
    points: [{ at: at('2026-01-26T12:00:00.000Z'), value: 80.93 }],
  }

  it('reads in metres NGF, unmoved, whichever datum was picked', () => {
    for (const picked of ['gauge', 'ngf'] as const) {
      const shown = levelSeriesIn(level, levelView('ngf', picked, null))

      expect(shown.unit).toBe('m NGF')
      expect(shown.points[0]?.value).toBe(80.93)
    }
  })

  it('leaves its thresholds where the source put them', () => {
    expect(ladderIn([{ ...RUNG, value: 81.5 }], levelView('ngf', 'gauge', null))).toEqual([
      { ...RUNG, value: 81.5 },
    ])
  })
})

/** Mayral at Rustiques, whose gauge zero stands at 127.55 m NGF. */
describe('a level the source measures in metres NGF', () => {
  const level = {
    quantity: 'level' as const,
    unit: 'm',
    points: [{ at: at('2026-01-26T12:00:00.000Z'), value: 129.49 }],
  }

  it('reads in metres NGF as measured', () => {
    const shown = levelSeriesIn(level, levelView('ngf', 'ngf', 127.55))

    expect(shown.unit).toBe('m NGF')
    expect(shown.points[0]?.value).toBe(129.49)
  })

  it('reads in metres as the measure lowered by the altitude of the gauge zero', () => {
    const shown = levelSeriesIn(level, levelView('ngf', 'gauge', 127.55))

    expect(shown.unit).toBe('m')
    expect(shown.points[0]?.value).toBe(1.94)
  })

  it('lowers the ladder it is read against by as much', () => {
    expect(ladderIn([{ ...RUNG, value: 128.5 }], levelView('ngf', 'gauge', 127.55))).toEqual([
      { ...RUNG, value: 0.95 },
    ])
  })
})
