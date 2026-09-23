import {
  ReportCollector,
  type Measure,
  type Position,
  type Quantity,
  type Station,
  type Threshold,
  type ThresholdNature,
} from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { deriveCrossings } from '../src/replay/crossings.ts'

const BERRE: Position = { lon: 2.8346, lat: 43.0387 }

function station(id: number, position: Position | null = BERRE): Station {
  return {
    id,
    code: `Y0824010${id}`,
    name: `station ${id}`,
    comment: null,
    townCode: null,
    altitude: null,
    position,
    category: 'watercourse',
    categoryIsFallback: false,
    quantities: ['level'],
  }
}

/** A threshold ladder as the source returns one, in metres. */
const LADDER: Threshold[] = [
  ladder(1, 'Vigilance', 2.8),
  ladder(2, 'Alerte', 5.3),
  ladder(3, 'Crise', 6.7),
]

/* eslint-disable-next-line max-params -- four fields of a rung, plus the escape hatch the odd
   case needs */
function ladder(
  id: number,
  label: string,
  value: number,
  nature: ThresholdNature = 'alert-level',
  overrides: Partial<Threshold> = {},
): Threshold {
  return {
    stationId: 84,
    id,
    label,
    quantity: 'level',
    value,
    nature,
    natureIsFallback: false,
    color: '#ffcc00',
    ...overrides,
  }
}

/** One measure every five minutes, which is the cadence Aquasys serves at rest. */
function series(values: readonly number[], sourceId = 84, quantity: Quantity = 'level'): Measure[] {
  return values.map((value, index) => ({
    sourceId,
    quantity,
    at: new Date(Date.UTC(2018, 9, 15, 0, index * 5)).toISOString(),
    value,
  }))
}

function derive(
  measures: readonly Measure[],
  thresholds: readonly Threshold[] = LADDER,
  stations: readonly Station[] = [station(84)],
) {
  const collector = new ReportCollector('replay:crossings', {})
  const result = deriveCrossings({ measures, thresholds, stations, collector })
  return { ...result, report: collector.seal() }
}

describe('a level that rises through a threshold', () => {
  it('opens an event at the instant the measure crossed it', () => {
    const { events } = derive(series([2.0, 2.5, 3.1, 3.4]))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      from: '2018-10-15T00:10:00.000Z',
      to: '2018-10-15T00:15:00.000Z',
      category: 'threshold-crossing',
      origin: 'automatic',
    })
  })

  /**
   * The instant carried is the one the observation has. Interpolating between
   * two measures would invent a time the source never reported.
   */
  it('never interpolates between two measures', () => {
    const { events } = derive(series([2.0, 3.1]))

    expect(events[0]?.from).toBe('2018-10-15T00:05:00.000Z')
  })

  it('closes it at the instant the level came back below', () => {
    const { events } = derive(series([2.0, 3.1, 3.0, 2.4]))

    expect(events[0]?.to).toBe('2018-10-15T00:15:00.000Z')
    expect(events[0]?.crossing?.stillActiveAtEnd).toBe(false)
  })

  it('opens a second event when the level crosses again', () => {
    const { events } = derive(series([2.0, 3.1, 2.4, 3.2]))

    expect(events).toHaveLength(2)
    expect(events.map((one) => one.from)).toEqual([
      '2018-10-15T00:05:00.000Z',
      '2018-10-15T00:15:00.000Z',
    ])
  })
})

describe('a series that never comes back below', () => {
  /**
   * `architecture.md`: an event with no end is punctual. A crossing that is
   * still on at the end of the period is not punctual, so it ends at the last
   * instant measured and says that is why.
   */
  it('ends at the last instant measured, and says it was still active', () => {
    const { events } = derive(series([2.0, 3.1, 3.4]))

    expect(events[0]?.to).toBe('2018-10-15T00:10:00.000Z')
    expect(events[0]?.crossing?.stillActiveAtEnd).toBe(true)
  })
})

describe('a series already above the threshold at its first measure', () => {
  /**
   * The map has to show the station in alert at t₀. Requiring a transition would
   * hide a station that was already over before the period began.
   */
  it('opens an event all the same', () => {
    const { events } = derive(series([3.1, 3.4, 2.0]))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ from: '2018-10-15T00:00:00.000Z' })
  })

  /**
   * The event stores nothing about whether the crossing predates the period:
   * that is `from <= period.from`, and the period is on the manifest every
   * reader opens first. A stored flag could only be wrong.
   */
  it('says nothing about the period, which the manifest already answers', () => {
    const { events } = derive(series([3.1, 3.4, 2.0]))

    expect(events[0]?.crossing).not.toHaveProperty('beganBeforeWindow')
  })
})

/**
 * Treating the three natures alike would invent a crossing at every historical
 * flood mark, and invert the logic on drought scales, whose values decrease as
 * the situation worsens.
 */
describe('the two natures that are not alert levels', () => {
  it('produce no event, and the report says how many were set aside', () => {
    const thresholds = [
      ladder(1, 'Vigilance', 2.8),
      ladder(4, 'Crue du 15/10/2018', 4.03, 'flood-mark'),
      ladder(5, 'Débit de vigilance', 0.1, 'drought-threshold'),
    ]
    const { events, setAside } = derive(series([2.0, 5.0]), thresholds)

    expect(events).toHaveLength(1)
    expect(events[0]?.crossing?.label).toBe('Vigilance')
    expect(setAside).toEqual({ 'flood-mark': 1, 'drought-threshold': 1 })
  })
})

describe('the severity of a crossing', () => {
  /**
   * The rank in the station's own ladder, by ascending value. Not a business
   * category: aquasys.md says the mapping onto Situation, Informatif and
   * Contrôle is established nowhere, and this does not invent it.
   */
  it('is the rank of the threshold in the ladder of its station and quantity', () => {
    const { events } = derive(series([2.0, 7.0]))

    const bySeverity = [...events].sort((a, b) => (a.severity ?? 0) - (b.severity ?? 0))
    expect(bySeverity.map((one) => [one.crossing?.label, one.severity])).toEqual([
      ['Vigilance', 1],
      ['Alerte', 2],
      ['Crise', 3],
    ])
  })

  /**
   * A rank alone says nothing across stations: rank 2 of 2 is the top of the
   * scale, rank 2 of 5 is not, and a feed sorting on the rank would put a minor
   * alert above a Crise.
   */
  it('carries the height of the ladder it is a rank in', () => {
    const { events } = derive(series([2.0, 7.0]))

    expect(events.every((one) => one.crossing?.ladderHeight === 3)).toBe(true)
  })
})

/**
 * A threshold whose nature was inferred from its label rather than read carries
 * the whole chronology of that station on a guess. Reported, never silent.
 */
describe('a crossing resting on a classification that was inferred', () => {
  it('is reported as a fallback', () => {
    const thresholds = [ladder(1, 'Vigilance', 2.8, 'alert-level', { natureIsFallback: true })]
    const { events, report } = derive(series([2.0, 3.1]), thresholds)

    expect(events).toHaveLength(1)
    expect(report.fallbacks).toMatchObject([{ subject: 'station 84 Vigilance' }])
  })

  it('is not reported when the threshold produced nothing', () => {
    const thresholds = [ladder(1, 'Vigilance', 2.8, 'alert-level', { natureIsFallback: true })]
    const { report } = derive(series([2.0, 2.1]), thresholds)

    expect(report.fallbacks).toEqual([])
  })
})

/**
 * No hysteresis: aquasys.md judges a crossing on the value at the instant, with
 * no accumulation. A probe oscillating around a threshold therefore produces a
 * flurry, and the count is what makes it visible rather than dissolved in the
 * list.
 */
describe('a probe oscillating around a threshold', () => {
  it('produces one event per crossing, and the flurry is counted', () => {
    const { events, singleStep } = derive(series([2.0, 3.1, 2.0, 3.1, 2.0, 3.1, 2.0]))

    expect(events).toHaveLength(3)
    expect(singleStep).toBe(3)
  })
})

/**
 * The two families number their sources independently, so an identifier alone
 * names one of each, and a rain gauge must never inherit a station's ladder.
 *
 * What holds today is the **quantity**: no quantity is collected on both
 * families, so a rain gauge's rainfall series is never a station's level. That
 * is a property of `reference/data-types.ts` and not of this join, and it would
 * end the day a quantity is collected on both — which is why the derivation says
 * so where it does the filtering.
 */
describe('a rain gauge numbered like a station', () => {
  it('gets none of the station thresholds, because no quantity is shared', () => {
    const measures = [...series([2.0, 7.0], 84), ...series([2.0, 7.0], 4, 'rainfall')]
    const thresholds = [{ ...ladder(1, 'Vigilance', 2.8), stationId: 4 }]
    const { events } = derive(measures, thresholds, [station(4)])

    // Station 4 exists and crosses; source 4's rainfall measures are not its level.
    expect(events).toHaveLength(0)
  })
})

describe('the identity of a crossing', () => {
  /**
   * A re-run regenerates the same identifiers, so no duplicate is possible and
   * an event an agent set aside stays recognisable after a regeneration.
   */
  it('is derived from the station, the quantity, the threshold and the start', () => {
    const first = derive(series([2.0, 3.1, 2.4]))
    const again = derive(series([2.0, 3.1, 2.4]))

    expect(first.events[0]?.id).toBe('crossing:84:level:1:2018-10-15T00:05:00.000Z')
    expect(again.events.map((one) => one.id)).toEqual(first.events.map((one) => one.id))
  })
})

describe('an event a crossing produced', () => {
  it('carries the station it happened on, so the map can place it', () => {
    const { events } = derive(series([2.0, 3.1]))

    expect(events[0]).toMatchObject({ sourceId: 84, position: BERRE, media: [] })
    expect(events[0]?.title).toContain('Vigilance')
  })

  it('carries the colour the API gave, so a replay matches what agents read elsewhere', () => {
    const { events } = derive(series([2.0, 3.1]))
    expect(events[0]?.color).toBe('#ffcc00')
  })

  it('carries no position when the station has none, rather than a wrong one', () => {
    const { events } = derive(series([2.0, 3.1]), LADDER, [station(84, null)])

    expect(events[0]?.position).toBeNull()
  })
})

describe('a period with nothing to report', () => {
  it('produces no event and no fallback', () => {
    const { events, report, singleStep } = derive(series([2.0, 2.1, 2.2]))

    expect(events).toEqual([])
    expect(report.fallbacks).toEqual([])
    expect(singleStep).toBe(0)
  })
})

/**
 * What the event says about the measure. A crossing is judged on the value at
 * the instant, with no accumulation, so the value the
 * event names as the crossing one must be that measure and not a maximum over
 * the episode — which would read "Vigilance crossed at 06:05 with the flood
 * peak", plausible and false.
 */
describe('the values a crossing reports', () => {
  it('names the measure that crossed, and the crest separately', () => {
    const { events } = derive(series([2.0, 2.9, 3.6, 3.0, 2.0]), [ladder(1, 'Vigilance', 2.8)])

    expect(events[0]?.crossing).toMatchObject({ value: 2.8, measured: 2.9, peak: 3.6 })
  })
})

/**
 * Reaching a threshold is crossing it: that is what `isOverrunThreshold` and
 * hydrological practice mean. Measures carry three decimals and thresholds one
 * or two, so exact equality is ordinary, not exotic.
 */
describe('a measure exactly equal to the threshold', () => {
  it('crosses it', () => {
    const { events } = derive(series([2.0, 2.8]), [ladder(1, 'Vigilance', 2.8)])

    expect(events).toHaveLength(1)
    expect(events[0]?.crossing?.measured).toBe(2.8)
  })
})

/**
 * `aquasys.md` names this trap: a threshold's `id` is unique within a station
 * *and* a quantity, never within a station. Station 84 carries two thresholds
 * numbered 1, one on the level and one on the flow.
 */
describe('two ladders of one station on two quantities', () => {
  it('stay apart, each ranked against its own', () => {
    const thresholds: Threshold[] = [
      ladder(1, 'Vigilance hauteur', 2.8),
      ladder(2, 'Alerte hauteur', 5.3),
      { ...ladder(1, 'Vigilance débit', 40), quantity: 'flow' },
    ]
    const measures = [...series([2.0, 6.0]), ...series([10, 50], 84, 'flow')]
    const { events } = derive(measures, thresholds)

    const flow = events.filter((one) => one.crossing?.quantity === 'flow')
    expect(flow).toHaveLength(1)
    // Ranked in its own ladder of one, not against the level thresholds.
    expect(flow[0]?.severity).toBe(1)
    expect(events.filter((one) => one.crossing?.quantity === 'level')).toHaveLength(2)
  })

  it('gives each its own identity even when the thresholds share a number', () => {
    const thresholds: Threshold[] = [
      ladder(1, 'Vigilance hauteur', 2.8),
      { ...ladder(1, 'Vigilance débit', 40), quantity: 'flow' },
    ]
    const measures = [...series([2.0, 3.0]), ...series([10, 50], 84, 'flow')]
    const { events } = derive(measures, thresholds)

    expect(new Set(events.map((one) => one.id)).size).toBe(2)
  })
})

describe('input that arrives in no particular order', () => {
  it('ranks a ladder by value, not by the order it was given', () => {
    const shuffled = [
      ladder(3, 'Crise', 6.7),
      ladder(1, 'Vigilance', 2.8),
      ladder(2, 'Alerte', 5.3),
    ]
    const { events } = derive(series([2.0, 7.0]), shuffled)

    const byLabel = new Map(events.map((one) => [one.crossing?.label, one.severity]))
    expect(byLabel.get('Vigilance')).toBe(1)
    expect(byLabel.get('Crise')).toBe(3)
  })

  it('walks a series by instant, not by the order it was given', () => {
    const ordered = series([2.0, 3.1, 2.0])
    const { events } = derive([ordered[2]!, ordered[0]!, ordered[1]!], [ladder(1, 'V', 2.8)])

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      from: '2018-10-15T00:05:00.000Z',
      to: '2018-10-15T00:10:00.000Z',
    })
  })

  /**
   * `instantSchema` accepts both second and millisecond precision, and the
   * clock module always compares as time for that reason: as strings,
   * `'…:00.500Z' < '…:00Z'` because `'.' < 'Z'`.
   */
  it('compares instants as time even when their precision differs', () => {
    const measures = [
      { sourceId: 84, quantity: 'level' as const, at: '2018-10-15T00:00:00Z', value: 2.0 },
      { sourceId: 84, quantity: 'level' as const, at: '2018-10-15T00:00:00.500Z', value: 3.1 },
    ]
    const { events } = derive(measures, [ladder(1, 'V', 2.8)])

    expect(events[0]?.from).toBe('2018-10-15T00:00:00.500Z')
    expect(events[0]?.to).toBe('2018-10-15T00:00:00.500Z')
  })
})

/**
 * Two measurement points of one station on one data type return interleaved
 * rows on the same instants. Kept as they are, two crossings would collide on
 * one identifier, and `rejeu.md` promises no duplicate is possible.
 */
describe('a series carrying two measures at the same instant', () => {
  it('keeps one and says it dropped the other', () => {
    const at = '2018-10-15T00:00:00.000Z'
    const measures = [3.1, 2.0, 3.2].map((value) => ({
      sourceId: 84,
      quantity: 'level' as const,
      at,
      value,
    }))
    const { events, report } = derive(measures, [ladder(1, 'V', 2.8)])

    expect(new Set(events.map((one) => one.id)).size).toBe(events.length)
    expect(report.fallbacks).toMatchObject([{ subject: 'station 84 level' }])
  })
})

/**
 * A station that goes off the air while above keeps its event open across the
 * hole. That is a choice — constant extrapolation — and `aquasys.md` requires
 * the interpolation choice to be stated because it shows directly on the
 * timeline.
 */
describe('a series with a hole in it', () => {
  it('holds the event open across the hole, on the last value known', () => {
    const measures = [
      { sourceId: 84, quantity: 'level' as const, at: '2018-10-15T00:00:00.000Z', value: 2.0 },
      { sourceId: 84, quantity: 'level' as const, at: '2018-10-15T00:05:00.000Z', value: 3.1 },
      { sourceId: 84, quantity: 'level' as const, at: '2018-10-15T12:05:00.000Z', value: 2.0 },
    ]
    const { events } = derive(measures, [ladder(1, 'V', 2.8)])

    expect(events).toHaveLength(1)
    expect(events[0]?.to).toBe('2018-10-15T12:05:00.000Z')
  })
})

describe('a ladder with nothing to walk', () => {
  it('says the station returned no series, rather than nothing at all', () => {
    const { events, report } = derive([], LADDER)

    expect(events).toEqual([])
    expect(report.sourcesWithoutData).toEqual([84])
  })

  it('says a threshold names a station outside the fleet', () => {
    const { report } = derive(series([2.0, 3.1]), LADDER, [])

    expect(report.fallbacks).toMatchObject([{ subject: 'station 84' }])
  })
})
