import { describe, expect, it } from 'vitest'

import { eventSchema, type ReplayEvent } from '../src/contracts/event.ts'

const FLOODED_FIELD = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [2.35, 43.21],
      [2.36, 43.21],
      [2.36, 43.22],
      [2.35, 43.21],
    ] as [number, number][],
  ],
}

function aReport(one: Partial<ReplayEvent> = {}): ReplayEvent {
  return {
    id: 'a1b2',
    origin: 'manual',
    category: 'field-report',
    title: 'RD 118 coupée',
    description: 'La route est sous l’eau au droit du pont.',
    producerKind: 'Commune',
    link: 'https://actualites.test/rd118-coupee',
    severity: null,
    color: null,
    from: '2019-10-22T06:00:00.000Z',
    to: null,
    position: FLOODED_FIELD,
    sourceId: null,
    media: ['events/a1b2/1.jpg', 'events/a1b2/2.jpg'],
    crossing: null,
    ...one,
  }
}

function aCrossing(one: Partial<ReplayEvent> = {}): ReplayEvent {
  return {
    id: 'crossing:84:level:11:2019-10-22T06:00:00.000Z',
    origin: 'automatic',
    category: 'threshold-crossing',
    title: 'Berre — Vigilance',
    description: null,
    producerKind: null,
    link: null,
    severity: 1,
    color: '#ffcc00',
    from: '2019-10-22T06:00:00.000Z',
    to: null,
    position: { type: 'Point', coordinates: [2.82, 43.3] },
    sourceId: 84,
    media: [],
    crossing: null,
    ...one,
  }
}

describe('an event an agent reported', () => {
  it('holds an area, a description, who reported it and its photos', () => {
    expect(eventSchema.safeParse(aReport()).success).toBe(true)
  })

  it('links to a web page, or to nothing', () => {
    expect(eventSchema.safeParse(aReport({ link: null })).success).toBe(true)
    expect(eventSchema.safeParse(aReport({ link: 'http://actualites.test/d118' })).success).toBe(
      true,
    )
    expect(eventSchema.safeParse(aReport({ link: 'javascript:alert(1)' })).success).toBe(false)
    expect(eventSchema.safeParse(aReport({ link: 'la D118' })).success).toBe(false)
  })

  it('names who reported it', () => {
    expect(eventSchema.safeParse(aReport({ producerKind: null })).success).toBe(false)
    expect(eventSchema.safeParse(aReport({ producerKind: '' })).success).toBe(false)
  })
})

describe('the span of an event', () => {
  it('may end on the instant it starts, whatever the precision of either', () => {
    const event = aReport({ from: '2019-10-22T06:00:00Z', to: '2019-10-22T06:00:00.000Z' })
    expect(eventSchema.safeParse(event).success).toBe(true)
  })

  it('does not end before it starts, whatever the precision of either', () => {
    const event = aReport({ from: '2019-10-22T06:00:00.500Z', to: '2019-10-22T06:00:00Z' })
    expect(eventSchema.safeParse(event).success).toBe(false)
  })
})

describe('an event the replay derived', () => {
  it('holds a point', () => {
    expect(eventSchema.safeParse(aCrossing()).success).toBe(true)
  })
})

describe('the area of an event', () => {
  it('has at least four points', () => {
    const closedOnThree = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [2.35, 43.21],
          [2.36, 43.21],
          [2.35, 43.21],
        ] as [number, number][],
      ],
    }

    expect(eventSchema.safeParse(aReport({ position: closedOnThree })).success).toBe(false)
  })

  /** An area the map would fill with nothing is placed, and never seen. */
  it('encloses something', () => {
    const ring = (...points: [number, number][]) => ({
      type: 'Polygon' as const,
      coordinates: [[...points, points[0]!]],
    })
    const refused = (position: ReturnType<typeof ring>) =>
      eventSchema.safeParse(aReport({ position })).error?.issues.map((one) => one.message)

    expect(refused(ring([2.35, 43.21], [2.35, 43.21], [2.35, 43.21]))).toContain('encloses nothing')
    expect(refused(ring([2.3, 43.2], [2.4, 43.2], [2.5, 43.2]))).toContain('encloses nothing')
    expect(refused(ring([2.3, 43.2], [2.4, 43.2], [2.35, 43.25]))).toBeUndefined()
  })

  it('does not cross itself', () => {
    const bowTie = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [2.3, 43.2],
          [2.4, 43.25],
          [2.4, 43.2],
          [2.3, 43.25],
          [2.3, 43.2],
        ] as [number, number][],
      ],
    }

    expect(
      eventSchema.safeParse(aReport({ position: bowTie })).error?.issues.map((one) => one.message),
    ).toContain('crosses itself')
  })

  it('keeps an ordinary area, a repeated vertex included', () => {
    const square = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [2.3, 43.2],
          [2.4, 43.2],
          [2.4, 43.2],
          [2.4, 43.25],
          [2.3, 43.25],
          [2.3, 43.2],
        ] as [number, number][],
      ],
    }

    expect(eventSchema.safeParse(aReport({ position: square })).success).toBe(true)
  })

  it('ends where it starts', () => {
    const open = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [2.35, 43.21],
          [2.36, 43.21],
          [2.36, 43.22],
          [2.35, 43.22],
        ] as [number, number][],
      ],
    }

    expect(eventSchema.safeParse(aReport({ position: open })).success).toBe(false)
  })
})
