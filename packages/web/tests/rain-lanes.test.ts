import { describe, expect, it } from 'vitest'

import { heldIn, lanesOf, type ReplayContent } from '../src/tracks/lanes.ts'
import { gaugesOf } from '../src/rain.ts'
import { aGauge, aMeasure, held, shown } from './support/content.ts'

const rained = (measures: [number, string, number][]) =>
  gaugesOf(measures.map(([id, when, value]) => aMeasure(id, when, value, 'rainfall')))

const parc = (rain: ReturnType<typeof rained>) =>
  held({ rainGauges: [aGauge(4, 'Couiza', 2.2), aGauge(9, 'Villegly', 2.4)], rain })

const rainFamily = (content: ReplayContent, mutesShown = true) =>
  shown(lanesOf(content), 'rain-gauge', mutesShown)

const laneOf = (content: ReplayContent, label: string, mutesShown = true) =>
  rainFamily(content, mutesShown)?.lanes.find((one) => one.label === label)

describe('a rain gauge lane', () => {
  it('draws a bar per measure, and reads as bars rather than segments', () => {
    const lane = laneOf(
      parc(
        rained([
          [4, '2019-10-22T06:00:00.000Z', 3],
          [4, '2019-10-22T07:00:00.000Z', 9],
        ]),
      ),
      'Couiza',
    )

    expect(lane?.bars).toBe(true)
    expect(lane?.marks).toHaveLength(2)
  })

  /**
   * The one thing this lane exists to show: a gauge that looked and saw nothing
   * is not a gauge nobody read, and only a bar of its own says the difference.
   */
  it('keeps a bar for a measure of zero', () => {
    const lane = laneOf(
      parc(
        rained([
          [4, '2019-10-22T06:00:00.000Z', 0],
          [4, '2019-10-22T07:00:00.000Z', 20],
        ]),
      ),
      'Couiza',
    )

    expect(lane?.marks.map((one) => one.height)).toEqual([0, 100])
  })

  /**
   * What it guards is that `parcScaleOf` floors at ten rather than answering
   * zero: divided by zero the heights would be `NaN`, and a bar of no number is
   * drawn nowhere at all.
   */
  it('gives a parc of nothing but zeroes bars of no height rather than of no number', () => {
    const lane = laneOf(
      parc(
        rained([
          [4, '2019-10-22T06:00:00.000Z', 0],
          [4, '2019-10-22T07:00:00.000Z', 0],
        ]),
      ),
      'Couiza',
    )

    expect(lane?.marks.map((one) => one.height)).toEqual([0, 0])
  })

  /**
   * The parc's heaviest step and never the gauge's own: a lane carries no axis,
   * so its bars are read against the lane above and the lane below. Given its
   * own scale, a gauge with one measure would draw it full height whatever it
   * measured — and that is two hundred and ten of the two hundred and fourteen
   * gauges of a whole-parc replay.
   */
  it('measures every bar of the parc against the heaviest step of the parc', () => {
    const content = parc(
      rained([
        [4, '2019-10-22T06:00:00.000Z', 10],
        [4, '2019-10-22T07:00:00.000Z', 40],
        [9, '2019-10-22T06:00:00.000Z', 80],
      ]),
    )

    expect(laneOf(content, 'Couiza')?.marks.map((one) => one.height)).toEqual([12.5, 50])
    expect(laneOf(content, 'Villegly')?.marks.map((one) => one.height)).toEqual([100])
  })

  /**
   * Without a floor, a parc whose heaviest step was two millimetres would draw
   * that step full height and read as a deluge.
   */
  it('never scales under the millimetre the map stops calling the rain negligible', () => {
    const lane = laneOf(parc(rained([[4, '2019-10-22T06:00:00.000Z', 5]])), 'Couiza')

    expect(lane?.marks.map((one) => one.height)).toEqual([50])
  })

  it('says what fell and over how long, for a bar wide enough to be read as a day', () => {
    const lane = laneOf(
      parc(
        rained([
          [4, '2019-10-22T06:00:00.000Z', 3],
          [4, '2019-10-22T07:00:00.000Z', 9.5],
        ]),
      ),
      'Couiza',
    )

    expect(lane?.marks[1]?.label).toBe('9,5 mm sur 1 heure')
  })

  it('leaves a gauge that measured nothing an empty lane, for the switch to hold back', () => {
    const lane = laneOf(parc(rained([[4, '2019-10-22T06:00:00.000Z', 3]])), 'Villegly')

    expect(lane?.marks).toEqual([])
  })
})

describe('a rain gauge lane, in the view a reader opens on', () => {
  /**
   * The default view, which every reader opens on. A gauge that looked twice
   * and saw nothing has measured, and nothing about it is missing.
   */
  it('keeps the lane of a gauge whose every measure was zero', () => {
    const content = parc(
      rained([
        [4, '2019-10-22T06:00:00.000Z', 0],
        [4, '2019-10-22T07:00:00.000Z', 0],
      ]),
    )

    expect(rainFamily(content, false)?.lanes.map((one) => one.label)).toEqual(['Couiza'])
    expect(rainFamily(content, false)?.held).toBe(1)
  })

  /**
   * A replay whose stations measured and whose gauges returned nothing gives an
   * empty map, not an absent one. Collapsed into a silent family, the whole parc
   * would be held back with no count on the switch — so the switch would vanish
   * and nothing could bring two hundred and fourteen gauges back.
   */
  it('holds back a parc that returned nothing, and leaves the switch a count', () => {
    const content = parc(rained([]))
    const family = rainFamily(content, false)

    expect(family?.lanes).toEqual([])
    expect(family?.held).toBe(2)
    expect(heldIn(lanesOf(content))).toBe(2)
    expect(rainFamily(content)?.lanes).toHaveLength(2)
  })

  /** A height below the floor of a lane cannot be drawn; the figure still can. */
  it('draws a negative measure at no height, and keeps its figure in the label', () => {
    const lane = rainFamily(
      parc(
        rained([
          [4, '2019-10-22T06:00:00.000Z', 20],
          [4, '2019-10-22T07:00:00.000Z', -5],
        ]),
      ),
      true,
    )?.lanes.find((one) => one.label === 'Couiza')

    expect(lane?.marks.map((one) => one.height)).toEqual([100, 0])
    expect(lane?.marks[1]?.label).toBe('-5 mm sur 1 heure')
  })
})

/**
 * A daily gauge's step covers the whole period, and the measure taken on the
 * period's first instant covers hours before it — a sliver at the very left.
 * Left in their own order the sliver is buried under the wide one, and a bar
 * nobody can see is exactly what an absence looks like.
 */
describe('the order a lane of bars is laid in', () => {
  it('puts the widest first, so a sliver is not buried under the step over it', () => {
    const lane = laneOf(
      parc(
        rained([
          [4, '2019-10-22T00:00:00.000Z', 2],
          [4, '2019-10-23T00:00:00.000Z', 8],
        ]),
      ),
      'Couiza',
    )

    expect(lane?.marks.map((one) => one.width)).toEqual([100, 0.4])
  })
})
