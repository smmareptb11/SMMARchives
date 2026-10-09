import { describe, expect, it } from 'vitest'

import {
  endNamed,
  eventOf,
  imageRefusal,
  imageRefusedSaid,
  startNamed,
  type Draft,
} from '../src/events/draft.ts'
import { A_MOMENT, phaseAt, shownUntil } from '../src/events/span.ts'
import { eventRefusedSaid, refusalsSaid } from '../src/events/refusals.ts'
import { familiesOf } from '../src/map/families.ts'
import { ApiError } from '../src/problems.ts'
import { coloursAt } from '../src/map/state.ts'
import { crossingCount, drawnMarks, lanesOf } from '../src/tracks/lanes.ts'
import { aCrossing, aStation, aWrittenEvent, at, held, period } from './support/content.ts'

/** A replay of the whole territory over the given period. */
const scopeOf = (window: { from: string; to: string }) => ({ period: window, extent: null })

const typed: Draft = {
  title: '  D118 coupée  ',
  description: '',
  // French time: eleven o'clock in Paris is nine UTC in October.
  from: '2019-10-22T11:00',
  to: '',
  provenance: '',
  position: null,
}

describe('what an agent typed, as the API will receive it', () => {
  it('is an instant on the single clock, and nothing for what was left empty', () => {
    expect(eventOf(typed, scopeOf(period))).toEqual({
      event: {
        title: 'D118 coupée',
        description: null,
        from: '2019-10-22T09:00:00.000Z',
        to: null,
        position: null,
        provenance: null,
      },
    })
  })

  it('keeps what was filled in', () => {
    const filled = {
      ...typed,
      description: ' Route inondée ',
      to: '2019-10-22T21:00',
      provenance: 'fire-service' as const,
      position: { lon: 2.3, lat: 43.1 },
    }

    expect(eventOf(filled, scopeOf(period))).toMatchObject({
      event: {
        description: 'Route inondée',
        to: '2019-10-22T19:00:00.000Z',
        provenance: 'fire-service',
        position: { lon: 2.3, lat: 43.1 },
      },
    })
  })

  it('needs a title and a start, and says so for each', () => {
    expect(eventOf({ ...typed, title: '  ', from: '' }, scopeOf(period))).toEqual({
      refusals: {
        title: 'Le titre est obligatoire.',
        from: 'La date de début est obligatoire.',
      },
    })
  })

  /**
   * A wall time does not always name the instant it came from: the seconds go,
   * and the hour the clocks go back names two instants.
   */
  it('starts at the instant offered while the field still says it', () => {
    // The second 02:30 of 2019-10-27, after the clocks went back.
    const offered = '2019-10-27T01:30:00.000Z'
    const autumn = { from: '2019-10-26T22:00:00.000Z', to: '2019-10-27T23:00:00.000Z' }

    expect(eventOf({ ...typed, from: '2019-10-27T02:30' }, scopeOf(autumn), offered)).toMatchObject(
      {
        event: { from: offered },
      },
    )
  })

  /** Read as the first 02:45, the end would fall before a start in the second. */
  it('ends in the second of the repeated hours when it starts in it', () => {
    const offered = '2019-10-27T01:30:00.000Z'
    const autumn = { from: '2019-10-26T22:00:00.000Z', to: '2019-10-27T23:00:00.000Z' }
    const draft = { ...typed, from: '2019-10-27T02:30', to: '2019-10-27T02:45' }

    expect(eventOf(draft, scopeOf(autumn), offered)).toMatchObject({
      event: { from: offered, to: '2019-10-27T01:45:00.000Z' },
    })
  })

  /** What is said under each field is what is sent. */
  it('says under the fields the instants it sends', () => {
    const offered = '2019-10-27T01:30:00.000Z'
    const from = startNamed('2019-10-27T02:30', offered)

    expect(from).toBe(offered)
    expect(endNamed('2019-10-27T02:45', from)).toBe('2019-10-27T01:45:00.000Z')
    expect(endNamed('2019-10-27T02:45', '2019-10-27T00:30:00.000Z')).toBe(
      '2019-10-27T00:45:00.000Z',
    )
  })

  it('keeps the seconds of a period that starts between two minutes', () => {
    const offered = '2019-10-22T08:00:30.000Z'
    const late = { from: offered, to: '2019-10-23T00:00:00.000Z' }

    expect(eventOf({ ...typed, from: '2019-10-22T10:00' }, scopeOf(late), offered)).toMatchObject({
      event: { from: offered },
    })
  })

  it('takes what the agent typed once they changed it', () => {
    expect(
      eventOf({ ...typed, from: '2019-10-22T12:00' }, scopeOf(period), '2019-10-22T09:00:00.000Z'),
    ).toMatchObject({ event: { from: '2019-10-22T10:00:00.000Z' } })
  })

  it('refuses a place outside the extent of the replay, in French', () => {
    const extent = { minLon: 2.0, minLat: 42.9, maxLon: 2.6, maxLat: 43.3 }
    const far = { ...typed, position: { lon: 3.0, lat: 43.1 } }

    expect(eventOf(far, { period, extent })).toEqual({
      refusals: { position: "L'événement doit être placé dans l'emprise du rejeu." },
    })
    expect(
      eventOf({ ...far, position: { lon: 2.3, lat: 43.1 } }, { period, extent }),
    ).toHaveProperty('event')
  })

  /** A replay without an extent covers the territory, and is held to it. */
  it('holds a replay without an extent to the territory', () => {
    const abroad = { ...typed, position: { lon: 150, lat: -30 } }

    expect(eventOf(abroad, scopeOf(period))).toHaveProperty('refusals.position')
  })

  it('refuses a start outside the replay', () => {
    expect(eventOf({ ...typed, from: '2019-10-24T11:00' }, scopeOf(period))).toEqual({
      refusals: { from: 'Le début doit tomber dans la période du rejeu.' },
    })
  })

  it('refuses an end before the start, compared as instants', () => {
    expect(eventOf({ ...typed, to: '2019-10-22T10:59' }, scopeOf(period))).toEqual({
      refusals: { to: 'La fin ne peut pas précéder le début.' },
    })
  })
})

describe('an image an agent attaches', () => {
  const limit = 10 * 1024 * 1024

  it('is one of the three formats the API keeps', () => {
    expect(imageRefusal({ type: 'image/jpeg', size: 1 }, limit)).toBeUndefined()
    expect(imageRefusal({ type: 'image/webp', size: 1 }, limit)).toBeUndefined()
    expect(imageRefusal({ type: 'image/svg+xml', size: 1 }, limit)).toBeDefined()
    expect(imageRefusal({ type: 'application/pdf', size: 1 }, limit)).toBeDefined()
  })

  /** Refused before the event exists, or the event stays behind without it. */
  it('weighs no more than the API takes, said in megabytes', () => {
    expect(imageRefusal({ type: 'image/jpeg', size: limit }, limit)).toBeUndefined()
    expect(imageRefusal({ type: 'image/jpeg', size: limit + 1 }, limit)).toBe(
      "L'image dépasse la taille autorisée (10 Mo au plus).",
    )
  })

  it('is let through when the limit is not known, for the API to judge', () => {
    expect(imageRefusal({ type: 'image/jpeg', size: 1e9 }, undefined)).toBeUndefined()
  })

  it('is refused in French, from the status the API answered', () => {
    expect(imageRefusedSaid(413)).toBe('elle dépasse la taille autorisée.')
    expect(imageRefusedSaid(415)).toBe("son format n'est pas reconnu (JPEG, PNG ou WebP).")
  })
})

describe('how long an event is shown', () => {
  it('is its own span when it has an end', () => {
    const lasting = aWrittenEvent({ to: '2019-10-22T19:00:00.000Z' })
    expect(shownUntil(lasting)).toBe(at('2019-10-22T19:00:00.000Z'))
  })

  /** A point in time drawn as such is a sliver nobody sees go by. */
  it('is a minute for a point in time', () => {
    expect(shownUntil(aWrittenEvent())).toBe(at('2019-10-22T09:00:00.000Z') + A_MOMENT)
  })

  it('is ahead before it starts, and past once its minute is over, not gone', () => {
    const event = aWrittenEvent()

    expect(phaseAt(event, at('2019-10-22T08:59:59.000Z'))).toBe('ahead')
    expect(phaseAt(event, at('2019-10-22T09:00:30.000Z'))).toBe('ongoing')
    expect(phaseAt(event, at('2019-10-22T09:01:01.000Z'))).toBe('past')
  })
})

describe('the events an agent wrote, on the screen', () => {
  it('have a lane of their own, first, that opens each of them', () => {
    const [first] = lanesOf(held({ events: [aWrittenEvent()] }))

    expect(first?.label).toBe('Événements saisis')
    expect(first?.lanes[0]?.marks).toEqual([
      expect.objectContaining({ at: '2019-10-22T09:00:00.000Z', event: aWrittenEvent().id }),
    ])
  })

  it('are drawn over the minute a point in time is given', () => {
    const [mark] = lanesOf(held({ events: [aWrittenEvent()] }))[0]?.lanes[0]?.marks ?? []

    // A minute of a day is a sliver under the floor every mark is drawn at.
    expect(mark?.width).toBeGreaterThan(0)
  })

  /** Two events of one morning are two facts, where two pictures are a smear. */
  it('are all drawn, however close they stand', () => {
    const early = aWrittenEvent({ id: 'early', from: '2019-10-22T02:03:00.000Z' })
    const later = aWrittenEvent({ id: 'later', from: '2019-10-22T03:00:00.000Z' })
    const lane = lanesOf(held({ events: [early, later] }))[0]?.lanes[0]

    expect(lane?.label).toBe('Saisie manuelle')
    expect(lane === undefined ? [] : drawnMarks(lane, 6).map((one) => one.event)).toEqual([
      'early',
      'later',
    ])
  })

  /**
   * The form offers the reading's instant as a start: two events written
   * without moving the cursor stand on the same instant, and neither may hide
   * the other.
   */
  it('stand on rows of their own when they would cover one another', () => {
    const first = aWrittenEvent({ id: 'first' })
    const second = aWrittenEvent({ id: 'second' })
    const apart = aWrittenEvent({ id: 'apart', from: '2019-10-22T18:00:00.000Z' })
    const lane = lanesOf(held({ events: [first, second, apart] }))[0]?.lanes[0]

    expect(lane?.rows).toBe(2)
    expect(lane?.marks.map((one) => [one.event, one.row])).toEqual([
      ['first', 0],
      ['second', 1],
      ['apart', 0],
    ])
  })

  it('stand on a single row when none covers another', () => {
    const early = aWrittenEvent({ id: 'early', from: '2019-10-22T02:00:00.000Z' })
    const later = aWrittenEvent({ id: 'later', from: '2019-10-22T18:00:00.000Z' })

    expect(lanesOf(held({ events: [early, later] }))[0]?.lanes[0]?.rows).toBe(1)
  })

  /** One lane holds them all, so its heading counts events and not lanes. */
  it('are counted one by one on the heading of their family', () => {
    const events = ['a', 'b', 'c'].map((id) => aWrittenEvent({ id }))

    expect(lanesOf(held({ events }))[0]?.count).toBe(3)
  })

  it('hold no lane when there are none', () => {
    expect(lanesOf(held()).map((one) => one.id)).not.toContain('written')
  })

  it('are a family of the map once one has a place, and not before', () => {
    expect(familiesOf(held({ events: [aWrittenEvent()] }))).toContain('event')
    expect(familiesOf(held({ events: [aWrittenEvent({ position: null })] }))).not.toContain('event')
  })

  /** « 3 franchissements sur 15 » would read as a replay mostly guessed. */
  it('are not counted among the crossings the replay derived', () => {
    const events = [aCrossing({ sourceId: 1 }), aWrittenEvent(), aWrittenEvent({ id: 'b' })]

    expect(crossingCount(held({ events }))).toBe(1)
  })

  /** A crossing joins the hydro fleet and nothing else. */
  it('never colour a station, even one sharing the place or the instant', () => {
    const station = aStation(1, 'Trèbes')
    const written = aWrittenEvent({ color: '#ff0000' })

    expect(coloursAt([written], [station], at('2019-10-22T09:00:30.000Z')).size).toBe(0)
    expect(
      coloursAt([written, aCrossing({ sourceId: 1 })], [station], at('2019-10-22T09:00:30.000Z')),
    ).toEqual(new Map([['watercourse:1', '#ffff00']]))
  })
})

describe('what the API refused, as the agent reads it', () => {
  it('names the field and the reason in French', () => {
    expect(
      refusalsSaid([
        { path: 'position', message: 'must fall within the extent of the replay' },
        { path: 'to', message: 'ends before it starts' },
      ]),
    ).toEqual([
      "Localisation : doit tomber dans l'emprise du rejeu",
      'Fin : ne peut pas précéder le début',
    ])
  })

  /** The line still says something was refused, and the server's log says what. */
  it('says in general terms what it does not know, rather than in English', () => {
    expect(refusalsSaid([{ path: 'origin', message: 'Invalid option' }])).toEqual([
      'Un champ : valeur refusée',
    ])
  })

  it('opens on the status the API answered, not its English detail', () => {
    const refused = new ApiError({
      type: 'bad-request',
      title: 'Bad request',
      status: 400,
      detail: 'x',
    })

    expect(eventRefusedSaid(refused)).toBe("L'événement n'a pas été accepté :")
  })
})
