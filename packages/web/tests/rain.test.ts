import { describe, expect, it } from 'vitest'

import type { Measure } from '@smmarchives/shared/contracts/measure.ts'

import {
  barSaid,
  scaleOf,
  spanSaid,
  gaugesOf,
  rainAt,
  shadeOf,
  SHADES,
  stepSaid,
  stepsOf,
  UNMEASURED,
} from '../src/rain.ts'
import { NEUTRAL } from '../src/map/state.ts'
import { aMeasure, at } from './support/content.ts'

/** What a colour is made of, to say a blue is a blue and not merely a string. */
const channelsOf = (colour: string) =>
  [1, 3, 5].map((one) => Number.parseInt(colour.slice(one, one + 2), 16))

const GAUGE = 4

const fell = (instant: string, millimetres: number, sourceId = GAUGE) =>
  aMeasure(sourceId, instant, millimetres, 'rainfall')

const shower = [
  fell('2019-10-22T06:00:00.000Z', 2),
  fell('2019-10-22T07:00:00.000Z', 5),
  fell('2019-10-22T08:00:00.000Z', 11),
]

const gauge = (measures = shower, sourceId = GAUGE) => gaugesOf(measures).get(sourceId)

/** The same, for a suite that means to read it rather than to test its absence. */
const gaugeOf = (measures: readonly Measure[], sourceId = GAUGE) => {
  const held = gaugesOf(measures).get(sourceId)
  if (held === undefined) throw new Error('the factory just put it there')

  return held
}

describe('the rain of the parc, gauge by gauge', () => {
  it('is that gauge alone, and its rain alone', () => {
    const mixed = [
      ...shower,
      fell('2019-10-22T06:30:00.000Z', 100, 7),
      aMeasure(GAUGE, '2019-10-22T06:30:00.000Z', 50, 'level'),
    ]

    expect(gauge(mixed)?.fallen.at(-1)?.millimetres).toBe(18)
  })

  /** « It did not rain » and « nobody measured » must not read the same. */
  it('holds no gauge that measured nothing, and one that measured zero', () => {
    expect(gauge(shower, 9)).toBeUndefined()
    expect(gauge([fell('2019-10-22T06:00:00.000Z', 0)])?.fallen).toHaveLength(1)
  })

  /** Each point is what fell during its step, not a level: they add up. */
  it('runs the totals up, oldest first, whatever order the measures arrive in', () => {
    const jumbled = [shower[2], shower[0], shower[1]].filter((one) => one !== undefined)

    expect(gauge(jumbled)?.fallen.map((one) => one.millimetres)).toEqual([2, 7, 18])
  })
})

describe('what a rain gauge had measured', () => {
  const read = (instant: string) => rainAt(gauge()!, at(instant))

  it('is what had fallen up to the instant, counting the instant itself', () => {
    expect(read('2019-10-22T07:00:00.000Z').millimetres).toBe(7)
    expect(read('2019-10-22T07:59:59.000Z').millimetres).toBe(7)
  })

  it('is nothing at all before the first measure', () => {
    expect(read('2019-10-22T05:00:00.000Z')).toMatchObject({ millimetres: 0, last: undefined })
  })

  it('carries the instant of the last measure counted, not of the last one held', () => {
    expect(read('2019-10-22T07:30:00.000Z').last).toBe(at('2019-10-22T07:00:00.000Z'))
  })

  /** The step is of the whole period: a bubble says it before the cursor reaches it. */
  it('carries the step of every measure, whatever the cursor has reached', () => {
    expect(read('2019-10-22T05:00:00.000Z').stepMinutes).toBe(60)
  })

  it('has no step to carry for a gauge holding a single measure', () => {
    expect(gauge([fell('2019-10-22T06:00:00.000Z', 83)])?.stepMinutes).toBeUndefined()
  })
})

describe('how often a gauge measured, as the bubble says it', () => {
  /** The two steps the floods measured give, and the only two anybody expects. */
  it('names a minute, an hour and a day without a figure', () => {
    expect(stepSaid(1)).toBe('Une mesure par minute.')
    expect(stepSaid(60)).toBe('Une mesure par heure.')
    expect(stepSaid(1440)).toBe('Une mesure par jour.')
  })

  /** A day is masculine and an hour is not, which no shared suffix would catch. */
  it('gives the step it found rather than a class it would have to defend', () => {
    expect(stepSaid(13)).toBe('Une mesure toutes les 13 minutes.')
    expect(stepSaid(150)).toBe('Une mesure toutes les 2,5 heures.')
    expect(stepSaid(2880)).toBe('Une mesure tous les 2 jours.')
  })

  it('says a period holding a single measure rather than a step of nothing', () => {
    expect(stepSaid(undefined)).toBe('Une seule mesure sur la période.')
  })
})

describe('the class the map reads a total in', () => {
  const [palest, second, , fourth, darkest] = SHADES

  /**
   * Written out rather than read back from the ramp: a test that takes its
   * expectation from the thing it tests moves with it, and the ramp could be
   * turned upside down — no rain painted navy, two hundred millimetres painted
   * white — under a green suite. The figures are what two replays are compared
   * through, so they are pinned here and changed on purpose or not at all.
   */
  it('is fixed, and these are its bounds and its blues', () => {
    expect(SHADES.map((one) => [one.from, one.colour])).toEqual([
      [0, '#dce9f6'],
      [10, '#a9cce5'],
      [50, '#5ba3d0'],
      [100, '#2171b5'],
      [200, '#08306b'],
    ])
  })

  /** A hue that is not a blue would be read as a threshold's colour. */
  it('says its classes in blue, which is the other language on the map', () => {
    for (const { colour } of SHADES) {
      const [red, green, blue] = channelsOf(colour)

      expect(blue).toBeGreaterThan(green!)
      expect(green).toBeGreaterThan(red!)
    }
  })

  it('opens a class on its own bound, so a bound reads as the class above', () => {
    expect(shadeOf(0)).toBe(palest.colour)
    expect(shadeOf(9.9)).toBe(palest.colour)
    expect(shadeOf(second.from)).toBe(second.colour)
    expect(shadeOf(darkest.from - 0.1)).toBe(fourth.colour)
    expect(shadeOf(darkest.from)).toBe(darkest.colour)
  })

  /** The last class is open: the Aude gave 214 mm, and a worse flood exists. */
  it('holds the darkest above the last bound rather than running out', () => {
    expect(shadeOf(2000)).toBe(darkest.colour)
  })

  /** Two classes sharing a blue would merge on the map without saying so. */
  it('gives each class a blue of its own, and none of them the grey', () => {
    const blues = SHADES.map((one) => one.colour)

    expect(new Set(blues).size).toBe(SHADES.length)
    expect(blues).not.toContain(UNMEASURED)
  })

  /**
   * The colour to be told from is the map's own neutral, and not another blue
   * of the ramp: a gauge nobody measured painted `NEUTRAL` reads as a station
   * under every threshold, which is the other language of colour entirely.
   */
  it('leaves the blue of a station to the stations, grey included', () => {
    expect([...SHADES.map((one) => one.colour), UNMEASURED]).not.toContain(NEUTRAL)
  })

  /**
   * A running total can drop: `gaugesOf` adds the values Aquasys gives with no
   * floor under them, and a corrected measure is a negative one. Below the
   * first bound is still the palest, and never the grey of a gauge that
   * measured nothing.
   */
  it('holds the palest under the first bound rather than falling out of the ramp', () => {
    expect(shadeOf(-1)).toBe(palest.colour)
  })
})

describe('what each measure of a gauge added', () => {
  const gauge = (measures: [string, number][]) =>
    gaugeOf(measures.map(([when, value]) => fell(when, value)))

  /**
   * The totals are run up once for the map, and the bars read back what each
   * measure put in. Two sources for the same figures would let the lane and the
   * bubble disagree about one measure.
   */
  it('undoes the running total, measure by measure', () => {
    const steps = stepsOf(
      gauge([
        ['2019-10-22T01:00:00.000Z', 3],
        ['2019-10-22T02:00:00.000Z', 0],
        ['2019-10-22T03:00:00.000Z', 12.5],
      ]),
    )

    expect(steps.map((one) => one.millimetres)).toEqual([3, 0, 12.5])
  })

  /**
   * A measure of zero is a measure: the gauge looked and nothing had fallen,
   * which is not the same as a gauge nobody read.
   */
  it('keeps a measure of zero among them', () => {
    const steps = stepsOf(
      gauge([
        ['2019-10-22T01:00:00.000Z', 0],
        ['2019-10-22T02:00:00.000Z', 0],
      ]),
    )

    expect(steps).toHaveLength(2)
    expect(steps.every((one) => one.millimetres === 0)).toBe(true)
  })

  /**
   * The span a measure covers ends on its own instant: the total it carries is
   * reached there, and the interface already says a daily measure brings hours
   * that fell before the replay began.
   */
  it('spans the step that ends on the measure', () => {
    const steps = stepsOf(
      gauge([
        ['2019-10-22T01:00:00.000Z', 3],
        ['2019-10-22T02:00:00.000Z', 4],
      ]),
    )

    expect(steps[1]).toEqual({
      from: Date.parse('2019-10-22T01:00:00.000Z'),
      at: Date.parse('2019-10-22T02:00:00.000Z'),
      millimetres: 4,
    })
  })

  /**
   * One measure gives no step to read, and a span nobody measured would say the
   * gauge watched hours it may never have watched.
   */
  it('gives a lone measure no span at all', () => {
    const steps = stepsOf(gauge([['2019-10-22T01:00:00.000Z', 7]]))

    expect(steps[0]?.from).toBe(steps[0]?.at)
  })
})

describe('the height a bar is read on', () => {
  it('is the gauge own largest measure', () => {
    expect(scaleOf([step(40), step(12)])).toBe(40)
  })

  /**
   * Without a floor, a gauge whose heaviest step was two millimetres would draw
   * that step full height and read as a deluge.
   */
  it('never falls under the millimetre the map stops calling the rain negligible', () => {
    expect(scaleOf([step(2), step(0)])).toBe(10)
  })

  it('holds for a gauge that measured nothing but zeroes', () => {
    expect(scaleOf([step(0)])).toBe(10)
  })
})

const step = (millimetres: number) => ({ from: 0, at: 0, millimetres })

describe('the height every lane of the parc is read on', () => {
  const stepsOfAll = (gauges: ReturnType<typeof gaugesOf>) =>
    [...gauges.values()].flatMap((one) => stepsOf(one))

  it('is the heaviest step any gauge of it measured', () => {
    const parc = gaugesOf([
      fell('2019-10-22T06:00:00.000Z', 40),
      fell('2019-10-22T07:00:00.000Z', 20),
      fell('2019-10-22T06:00:00.000Z', 95, 9),
    ])

    expect(scaleOf(stepsOfAll(parc))).toBe(95)
  })

  it('never falls under the millimetre the map stops calling the rain negligible', () => {
    expect(scaleOf(stepsOfAll(gaugesOf([fell('2019-10-22T06:00:00.000Z', 2)])))).toBe(10)
  })

  it('holds for a parc nobody measured', () => {
    expect(scaleOf(stepsOfAll(gaugesOf([])))).toBe(10)
  })
})

describe('a gauge whose measures do not arrive in order', () => {
  it('runs the totals up in time, whatever order they came in', () => {
    const jumbled = gaugeOf([
      fell('2019-10-22T07:00:00.000Z', 9),
      fell('2019-10-22T05:00:00.000Z', 3),
      fell('2019-10-22T06:00:00.000Z', 0),
    ])

    expect(stepsOf(jumbled).map((one) => one.millimetres)).toEqual([3, 0, 9])
  })

  /**
   * Nothing in the contract forbids two rows on one instant, and Aquasys aligns
   * its dates on five minutes. Kept apart they give a median gap of zero, two
   * bars on one pixel and two marks under one key; added, they are what the
   * running total already made of them.
   */
  it('adds two measures taken on the same instant into one', () => {
    const twice = gaugeOf([
      fell('2019-10-22T06:00:00.000Z', 3),
      fell('2019-10-22T06:00:00.000Z', 4),
      fell('2019-10-22T07:00:00.000Z', 1),
    ])

    expect(stepsOf(twice).map((one) => one.millimetres)).toEqual([7, 1])
    expect(twice.stepMinutes).toBe(60)
  })

  /**
   * A negative increment is a bad reading, and the figure stays the gauge's own
   * here: what refuses to draw it below the floor of a lane is `barsOf`.
   */
  it('carries a negative measure through rather than swallowing it', () => {
    const dropped = gaugeOf([
      fell('2019-10-22T06:00:00.000Z', 5),
      fell('2019-10-22T07:00:00.000Z', -2),
    ])

    expect(stepsOf(dropped).map((one) => one.millimetres)).toEqual([5, -2])
  })
})

describe('the span a measure is drawn over', () => {
  /**
   * Aquasys serves event-driven series whose gaps are five, twenty-five and a
   * hundred and twenty minutes inside two days. Given the median, the bars of
   * one overlap and paint rain on hours it did not fall on.
   */
  it('begins where the measure before it was taken, never one median step back', () => {
    const uneven = gaugeOf([
      fell('2019-10-22T00:00:00.000Z', 2),
      fell('2019-10-22T00:05:00.000Z', 3),
      fell('2019-10-22T00:30:00.000Z', 4),
      fell('2019-10-22T02:30:00.000Z', 5),
    ])

    const steps = stepsOf(uneven)
    expect(steps.slice(1).map((one) => one.from)).toEqual(steps.slice(0, -1).map((one) => one.at))
  })

  it('falls back on the median for the first measure, which has nothing before it', () => {
    const hourly = gaugeOf([
      fell('2019-10-22T06:00:00.000Z', 2),
      fell('2019-10-22T07:00:00.000Z', 3),
    ])

    expect(stepsOf(hourly)[0]?.from).toBe(at('2019-10-22T05:00:00.000Z'))
  })
})

describe('what a bar of a lane says of itself', () => {
  it('names the span it covers, in hours and never in days', () => {
    expect(barSaid(7, spanSaid(1440))).toBe('7 mm sur 24 heures')
    expect(barSaid(7, spanSaid(120))).toBe('7 mm sur 2 heures')
    expect(barSaid(7, spanSaid(60))).toBe('7 mm sur 1 heure')
    expect(barSaid(7, spanSaid(5))).toBe('7 mm sur 5 minutes')
  })

  /** Three quarters of a whole-parc replay's gauges hold a single measure. */
  it('claims no span when the gauge gave no step to read', () => {
    expect(spanSaid(undefined)).toBeUndefined()
    expect(spanSaid(0)).toBeUndefined()
    expect(barSaid(7, undefined)).toBe('7 mm')
  })
})
