import { describe, expect, it } from 'vitest'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { NEUTRAL, coloursAt, paintedAt, paintingOf, rainColoursAt } from '../src/map/state.ts'
import { gaugesOf, SHADES, UNMEASURED } from '../src/rain.ts'
import { aCrossing, aGauge, aMeasure, aStation, at, held } from './support/content.ts'

describe('the colour a station shows at an instant', () => {
  const stations = [aStation(1, 'Trèbes')]

  it('is nothing at all while it is under every threshold', () => {
    const colours = coloursAt(
      [aCrossing({ sourceId: 1 })],
      stations,
      at('2019-10-22T03:00:00.000Z'),
    )

    expect(colours.size).toBe(0)
  })

  it('is the threshold it is in', () => {
    const colours = coloursAt(
      [aCrossing({ sourceId: 1 })],
      stations,
      at('2019-10-22T08:00:00.000Z'),
    )

    expect(colours.get('watercourse:1')).toBe('#ffff00')
  })

  it('is the highest of the thresholds it is in, whatever order they came in', () => {
    const low = aCrossing({ sourceId: 1, severity: 1, color: '#ffff00' })
    const high = aCrossing({ sourceId: 1, severity: 3, color: '#ff0000' })
    const eight = at('2019-10-22T08:00:00.000Z')

    expect(coloursAt([low, high], stations, eight).get('watercourse:1')).toBe('#ff0000')
    expect(coloursAt([high, low], stations, eight).get('watercourse:1')).toBe('#ff0000')
  })

  /** A crossing the source gave no rank sits at the bottom, never above a Crise. */
  it('does not let a crossing without a rank outrank one that has it', () => {
    const events = [
      aCrossing({ sourceId: 1, severity: null, color: '#00ff00' }),
      aCrossing({ sourceId: 1, severity: 3, color: '#ff0000' }),
    ]
    const colours = coloursAt(events, stations, at('2019-10-22T08:00:00.000Z'))

    expect(colours.get('watercourse:1')).toBe('#ff0000')
  })

  it('tells two stations apart, rather than painting both with the first it found', () => {
    const both = [aStation(1, 'Trèbes'), aStation(2, 'Narbonne')]
    const colours = coloursAt(
      [aCrossing({ sourceId: 2, color: '#ff0000' })],
      both,
      at('2019-10-22T08:00:00.000Z'),
    )

    expect(colours.get('watercourse:2')).toBe('#ff0000')
    expect(colours.has('watercourse:1')).toBe(false)
  })

  /** The border the comment names: a crossing closed on its own last measure. */
  it('still shows the threshold on the very instant the crossing ends', () => {
    const colours = coloursAt(
      [aCrossing({ sourceId: 1 })],
      stations,
      at('2019-10-22T12:00:00.000Z'),
    )

    expect(colours.get('watercourse:1')).toBe('#ffff00')
  })

  /**
   * A derived crossing always closes — on the last measurement when the water
   * never came back down, which `stillActiveAtEnd` says. The map ends the
   * colour where the lane ends the segment, or the two views disagree about
   * the same fact.
   */
  it('ends where the crossing ends, last measurement included', () => {
    const colours = coloursAt(
      [aCrossing({ sourceId: 1 })],
      stations,
      at('2019-10-22T18:00:00.000Z'),
    )

    expect(colours.size).toBe(0)
  })

  it('holds a crossing with no end to its own instant, which is what a point in time is', () => {
    const point = aCrossing({ sourceId: 1, to: null })

    expect(coloursAt([point], stations, at('2019-10-22T06:00:00.000Z')).get('watercourse:1')).toBe(
      '#ffff00',
    )
    expect(coloursAt([point], stations, at('2019-10-22T08:00:00.000Z')).size).toBe(0)
  })

  /**
   * The two Aquasys families number their sources independently: 58 rain gauges
   * of the SMMAR parc carry a station's identifier. Colouring by identifier
   * alone would light a rain gauge up with another source's alert — which holds
   * today only because no threshold bears on a rainfall quantity.
   */
  it('is handed out to the hydro fleet and to nobody else', () => {
    const colours = coloursAt(
      [aCrossing({ sourceId: 42 })],
      [aStation(1, 'Trèbes')],
      at('2019-10-22T08:00:00.000Z'),
    )

    expect(colours.size).toBe(0)
  })

  it('leaves a crossing the replay gave no colour out, rather than painting nothing', () => {
    const colours = coloursAt(
      [aCrossing({ sourceId: 1, color: null })],
      stations,
      at('2019-10-22T08:00:00.000Z'),
    )

    expect(colours.size).toBe(0)
  })

  /** Two ladders of one station, level and flow, cross at the same rank. */
  it('keeps the first of two crossings the replay ranked alike, and not the last', () => {
    const red = aCrossing({ sourceId: 1, severity: 2, color: '#ff0000' })
    const orange = aCrossing({ sourceId: 1, severity: 2, color: '#ffa500' })
    const shown = (events: ReplayEvent[]) =>
      coloursAt(events, stations, at('2019-10-22T08:00:00.000Z')).get('watercourse:1')

    expect(shown([red, orange])).toBe('#ff0000')
    expect(shown([orange, red])).toBe('#ffa500')
  })

  it('keeps the first of two crossings the replay ranked not at all', () => {
    const first = aCrossing({ sourceId: 1, severity: null, color: '#ff0000' })
    const second = aCrossing({ sourceId: 1, severity: null, color: '#ffa500' })

    expect(
      coloursAt([first, second], stations, at('2019-10-22T08:00:00.000Z')).get('watercourse:1'),
    ).toBe('#ff0000')
  })

  /** The pendant of the end bound: a crossing covers the instant it opens on. */
  it('shows the threshold from the very instant the crossing opens', () => {
    const colours = coloursAt(
      [aCrossing({ sourceId: 1 })],
      stations,
      at('2019-10-22T06:00:00.000Z'),
    )

    expect(colours.get('watercourse:1')).toBe('#ffff00')
  })
})

describe('what one family is painted with', () => {
  /**
   * The invariant `AGENTS.md` names, and the reason a colour is keyed by family
   * rather than by identifier: 58 rain gauges of the parc carry a station's
   * number, and a colour handed out by number would light one of them up with
   * another source's alert.
   */
  it('never paints a rain gauge, even when a station carries its identifier', () => {
    const colours = coloursAt(
      [aCrossing({ sourceId: 42, color: '#ff0000' })],
      [aStation(42, 'Trèbes')],
      at('2019-10-22T08:00:00.000Z'),
    )

    expect(colours.get('watercourse:42')).toBe('#ff0000')
    expect(paintingOf('rain-gauge', colours).branches).toEqual([])
  })

  /**
   * The ordinary case and not an edge one: every replay opens with its cursor
   * at the start, and a `match` expression refuses a call with no branch.
   */
  it('paints everything neutral when nothing is in alert', () => {
    const painting = paintingOf('watercourse', new Map())

    expect(painting.branches).toEqual([])
    expect(painting.fallback).toBe(NEUTRAL)
  })

  it('groups by colour, so a level in play costs one branch and not one per station', () => {
    const colours = new Map([
      ['watercourse:1', '#ff0000'],
      ['watercourse:2', '#ff0000'],
      ['watercourse:3', '#ffff00'],
    ])

    expect(paintingOf('watercourse', colours).branches).toEqual([
      { colour: '#ff0000', keys: ['watercourse:1', 'watercourse:2'] },
      { colour: '#ffff00', keys: ['watercourse:3'] },
    ])
  })

  it('leaves the sources of another family out of a family branch', () => {
    const colours = new Map([
      ['watercourse:1', '#ff0000'],
      ['structure:2', '#ffff00'],
    ])

    expect(paintingOf('structure', colours).branches).toEqual([
      { colour: '#ffff00', keys: ['structure:2'] },
    ])
  })
})

describe('the colour of every rain gauge at an instant', () => {
  const [palest, second] = SHADES
  const parc = [aGauge(4, 'Trèbes', 2.4), aGauge(9, 'Cuxac', 2.9)]
  const fell = (instant: string, millimetres: number) =>
    aMeasure(4, instant, millimetres, 'rainfall')
  const shower = [
    fell('2019-10-22T06:00:00.000Z', 2),
    fell('2019-10-22T07:00:00.000Z', 5),
    fell('2019-10-22T08:00:00.000Z', 11),
  ]
  const coloured = (instant: string) => rainColoursAt(parc, gaugesOf(shower), at(instant))

  it('names a gauge by its family, never by a number two families both give out', () => {
    expect([...coloured('2019-10-22T08:00:00.000Z').keys()]).toEqual([
      'rain-gauge:4',
      'rain-gauge:9',
    ])
  })

  it('darkens a gauge as what it had measured rises', () => {
    expect(coloured('2019-10-22T06:00:00.000Z').get('rain-gauge:4')).toBe(palest.colour)
    expect(coloured('2019-10-22T08:00:00.000Z').get('rain-gauge:4')).toBe(second.colour)
  })

  /** « Nobody measured » is not « it did not rain », and the map says which. */
  it('greys a gauge that measured nothing over the period', () => {
    expect(coloured('2019-10-22T08:00:00.000Z').get('rain-gauge:9')).toBe(UNMEASURED)
  })

  it('pales a gauge to its lightest before its first measure, and does not grey it', () => {
    expect(coloured('2019-10-22T05:00:00.000Z').get('rain-gauge:4')).toBe(palest.colour)
  })

  /** What a gauge left out would fall back on is the blue of a station. */
  it('leaves no gauge of the parc without a colour of its own', () => {
    expect(coloured('2019-10-22T08:00:00.000Z').size).toBe(parc.length)
  })

  /**
   * A build whose Aquasys lane failed serves its stations and its map. Greying
   * the parc would accuse each of two hundred and twenty-nine gauges of having
   * measured nothing, which is the lie the bubble already refuses to tell.
   */
  it('gives no colour at all when the replay knows no rain', () => {
    expect(rainColoursAt(parc, undefined, at('2019-10-22T08:00:00.000Z')).size).toBe(0)
  })
})

describe('everything the map paints at an instant', () => {
  /**
   * The collision the key shape exists to prevent: in a replay of the whole
   * parc, 58 rain gauge identifiers are also station identifiers.
   */
  it('gives a station and a rain gauge of the same number their own colours', () => {
    const content = held({
      stations: [aStation(4, 'Trèbes')],
      events: [aCrossing({ sourceId: 4 })],
      rainGauges: [aGauge(4, 'Trèbes P', 2.4)],
      rain: gaugesOf([aMeasure(4, '2019-10-22T06:00:00.000Z', 120, 'rainfall')]),
    })

    const painted = paintedAt(content, at('2019-10-22T08:00:00.000Z'))

    expect(painted.get('watercourse:4')).toBe('#ffff00')
    expect(painted.get('rain-gauge:4')).toBe(SHADES[3].colour)
  })
})
