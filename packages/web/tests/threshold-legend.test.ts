import { describe, expect, it } from 'vitest'

import { legendOf } from '../src/detail/legend.ts'
import { ladderOf, unitIn } from '../src/detail/series.ts'
import { ASSUMED_NATURE } from '../src/tracks/crossing.ts'
import { assumedIn } from '../src/tracks/heading.ts'
import { aThresholdOf } from './support/content.ts'

describe("the legend of a station's thresholds", () => {
  const ladder = ladderOf(
    [
      aThresholdOf({ stationId: 4, label: 'Vigilance', value: 2.8, color: '#ffff00' }),
      aThresholdOf({ stationId: 4, id: 2, label: 'Alerte', value: 3.5, color: '#ff9900' }),
      aThresholdOf({ stationId: 4, id: 3, label: 'Crise', value: 4.25, color: '#ff0000' }),
    ],
    4,
    'flow',
  )

  /** The chart reads from the top: the legend does too. */
  it('names each threshold with its value, the highest first', () => {
    expect(legendOf(ladder, 'm³/s').map((one) => one.said)).toEqual([
      'Crise — 4,25 m³/s',
      'Alerte — 3,5 m³/s',
      'Vigilance — 2,8 m³/s',
    ])
  })

  it('draws each in the colour the chart rules it in', () => {
    expect(legendOf(ladder, 'm³/s').map((one) => one.colour)).toEqual([
      '#ff0000',
      '#ff9900',
      '#ffff00',
    ])
  })

  it('says, and says why, when the type of a threshold was deduced', () => {
    const deduced = ladderOf([aThresholdOf({ stationId: 4, natureIsFallback: true })], 4, 'flow')

    expect(legendOf(deduced, 'm³/s')).toEqual([
      { colour: '#ffff00', said: 'Vigilance — 2,8 m³/s (type déduit)', why: ASSUMED_NATURE },
    ])
  })

  it('names nothing for a station with no threshold', () => {
    expect(legendOf([], 'm')).toEqual([])
  })

  it('is in the unit the curve is shown in', () => {
    expect(unitIn('flow', null)).toBe('m³/s')
    expect(unitIn('level', { datum: 'gauge', shift: 0 })).toBe('m')
    expect(unitIn('level', { datum: 'ngf', shift: 127.55 })).toBe('m NGF')
  })
})

describe('the stripes of a family, explained under its heading', () => {
  const mark = (assumed: boolean) => ({
    left: 0,
    width: 1,
    at: '2019-10-22T06:00:00.000Z',
    assumed,
  })
  const family = (assumed: boolean) => ({
    id: 'watercourse',
    label: 'Stations',
    lanes: [{ id: 'a', label: 'a', marks: [mark(assumed), mark(false)] }],
  })

  it('counts the crossings drawn striped', () => {
    expect(assumedIn(family(true))).toBe(1)
  })

  it('counts none in a family with no stripes, which then explains none', () => {
    expect(assumedIn(family(false))).toBe(0)
  })
})
