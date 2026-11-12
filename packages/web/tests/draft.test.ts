import { describe, expect, it } from 'vitest'

import {
  draftAt,
  draftOf,
  endOnEntry,
  hoursRefused,
  judged,
  PHOTO_COUNT_LIMIT,
  PHOTO_SIZE_LIMIT,
  placed,
  toCorrect,
  touched,
  type Draft,
} from '../src/events/draft.ts'
import { aReport, period } from './support/content.ts'

/** A draft that holds together, as the form spells it: French wall times. */
function aDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    title: 'Route coupée',
    producerKind: 'Agent SMMAR',
    from: '2019-10-22T08:00',
    to: '',
    description: '',
    link: '',
    position: null,
    near: { from: undefined, to: undefined },
    ...overrides,
  }
}

const JPEG = { size: 1_000, type: 'image/jpeg' }

describe('a blank form', () => {
  it('starts where the reading stands, in French time', () => {
    expect(draftAt('2019-10-22T06:30:00.000Z')).toMatchObject({ from: '2019-10-22T08:30', to: '' })
  })
})

describe('a form opened to amend an event', () => {
  const event = aReport({
    id: 'a',
    title: 'Route coupée',
    producerKind: 'Commune',
    description: 'Pont submergé.',
    link: 'https://actualites.test/d118-submergee',
    from: '2019-10-22T06:00:00.000Z',
    to: '2019-10-22T08:30:00.000Z',
    position: { type: 'Point', coordinates: [2.35, 43.21] },
  })

  it('is filled in with what the event says, in French time', () => {
    expect(draftOf(event)).toEqual({
      title: 'Route coupée',
      producerKind: 'Commune',
      from: '2019-10-22T08:00',
      to: '2019-10-22T10:30',
      description: 'Pont submergé.',
      link: 'https://actualites.test/d118-submergee',
      position: { type: 'Point', coordinates: [2.35, 43.21] },
      near: { from: event.from, to: event.to },
    })
  })

  it('sends back what the event said when nothing is changed', () => {
    expect(judged(draftOf(event), period, [])).toEqual({
      report: {
        title: event.title,
        producerKind: event.producerKind,
        from: event.from,
        to: event.to,
        description: event.description,
        link: event.link,
        position: event.position,
      },
    })
  })

  it('leaves blank what the event never said', () => {
    expect(draftOf(aReport({ id: 'b' }))).toMatchObject({ to: '', description: '', link: '' })
  })
})

describe('what a draft amounts to', () => {
  it('is a report on the single clock, its text trimmed', () => {
    expect(
      judged(aDraft({ title: '  Route coupée ', to: '2019-10-22T10:00' }), period, []),
    ).toEqual({
      report: {
        title: 'Route coupée',
        producerKind: 'Agent SMMAR',
        from: '2019-10-22T06:00:00.000Z',
        to: '2019-10-22T08:00:00.000Z',
        description: null,
        link: null,
        position: null,
      },
    })
  })

  it('keeps the description as typed, paragraphs included', () => {
    const verdict = judged(aDraft({ description: 'Pont submergé.\nDéviation.' }), period, [])

    expect(verdict).toMatchObject({ report: { description: 'Pont submergé.\nDéviation.' } })
  })

  it('keeps a link trimmed', () => {
    const verdict = judged(aDraft({ link: ' https://actualites.test/d118 ' }), period, [])

    expect(verdict).toMatchObject({ report: { link: 'https://actualites.test/d118' } })
  })

  it('refuses a link that opens no web page', () => {
    for (const link of ['javascript:alert(1)', 'ftp://actualites.test/d118', 'la D118']) {
      expect(judged(aDraft({ link }), period, [])).toEqual({
        refusals: { link: 'Un lien commence par http:// ou https://.' },
      })
    }
  })

  it('refuses a link the API would find too long', () => {
    const link = `https://actualites.test/${'a'.repeat(2_000)}`

    expect(judged(aDraft({ link }), period, [])).toEqual({
      refusals: { link: 'Le lien tient en 2 000 caractères.' },
    })
  })

  it('is no report without a title or someone who reported it', () => {
    expect(judged(aDraft({ title: ' ', producerKind: '' }), period, [])).toEqual({
      refusals: {
        title: 'Le titre dit ce qui s’est passé.',
        producerKind: 'Dites qui l’a signalé.',
      },
    })
  })

  it('refuses an instant outside the replay period', () => {
    expect(
      judged(aDraft({ from: '2019-10-22T01:59', to: '2019-10-23T02:01' }), period, []),
    ).toEqual({
      refusals: {
        from: 'Le début tombe hors de la période du rejeu.',
        to: 'La fin tombe hors de la période du rejeu.',
      },
    })
  })

  it('refuses an end before the start, and a start that is no date', () => {
    expect(judged(aDraft({ to: '2019-10-22T07:00' }), period, [])).toEqual({
      refusals: { to: 'La fin vient après le début.' },
    })
    expect(judged(aDraft({ from: '' }), period, [])).toEqual({
      refusals: { from: 'Le début est une date et une heure.' },
    })
  })

  it('refuses photos the API would refuse, before a megabyte is sent', () => {
    const tooMany = Array.from({ length: PHOTO_COUNT_LIMIT + 1 }, () => JPEG)

    expect(judged(aDraft(), period, tooMany)).toEqual({
      refusals: { photos: 'Un événement porte 10 photos au plus.' },
    })
    expect(judged(aDraft(), period, [{ size: 1, type: 'image/svg+xml' }])).toMatchObject({
      refusals: { photos: 'Une photo est une image JPEG, PNG ou WebP.' },
    })
    expect(
      judged(aDraft(), period, [{ size: PHOTO_SIZE_LIMIT + 1, type: 'image/png' }]),
    ).toMatchObject({ refusals: { photos: 'Une photo pèse 15 Mo au plus.' } })
    expect(judged(aDraft(), period, [JPEG])).toHaveProperty('report')
  })

  it('counts the photos an amended event keeps towards the limit', () => {
    expect(judged(aDraft(), period, [JPEG], PHOTO_COUNT_LIMIT - 1)).toHaveProperty('report')
    expect(judged(aDraft(), period, [JPEG], PHOTO_COUNT_LIMIT)).toEqual({
      refusals: { photos: 'Un événement porte 10 photos au plus.' },
    })
  })
})

describe('the hours, judged as soon as they are picked', () => {
  // The period runs from 02:00 on 22 October to 02:00 on the 23rd, French summer time.
  it('refuses an end after the replay', () => {
    expect(hoursRefused(aDraft({ to: '2019-10-23T03:00' }), period)).toEqual({
      to: 'La fin tombe hors de la période du rejeu.',
    })
  })

  it('refuses an end before the start', () => {
    expect(
      hoursRefused(aDraft({ from: '2019-10-22T10:00', to: '2019-10-22T09:00' }), period),
    ).toEqual({ to: 'La fin vient après le début.' })
  })

  it('refuses a start outside the replay', () => {
    expect(hoursRefused(aDraft({ from: '2019-10-21T10:00' }), period)).toEqual({
      from: 'Le début tombe hors de la période du rejeu.',
    })
  })

  it('has nothing to say of hours within the replay, with an end or without', () => {
    expect(hoursRefused(aDraft(), period)).toEqual({})
    expect(hoursRefused(aDraft({ to: '2019-10-22T09:00' }), period)).toEqual({})
  })

  it('says what the form would say on sending', () => {
    const draft = aDraft({ to: '2019-10-23T03:00' })
    const verdict = judged(draft, period, [])

    expect('refusals' in verdict ? verdict.refusals.to : undefined).toBe(
      hoursRefused(draft, period).to,
    )
  })
})

describe('the end of an event, as the agent fills it in', () => {
  it('is proposed a quarter of an hour after the start', () => {
    expect(endOnEntry(aDraft({ to: '' }))).toBe('2019-10-22T08:15')
  })

  /** 02:50 on the last Sunday of October, summer time, is followed by 02:05 winter time. */
  it('counts the quarter of an hour on the instant, across the change of clock', () => {
    expect(endOnEntry(aDraft({ from: '2019-10-27T02:50', to: '' }))).toBe('2019-10-27T02:05')
  })

  it('keeps an end already given', () => {
    expect(endOnEntry(aDraft({ to: '2019-10-22T10:00' }))).toBe('2019-10-22T10:00')
  })

  it('proposes nothing while the start is not a date', () => {
    expect(endOnEntry(aDraft({ from: '', to: '' }))).toBe('')
  })
})

/**
 * On 2019-10-27, Paris reads 02:00 to 02:59 twice: at 00:xxZ in summer time,
 * then at 01:xxZ in winter time. The field spells both the same.
 */
describe('the hour the change of clock names twice', () => {
  const night = { from: '2019-10-26T22:00:00.000Z', to: '2019-10-27T06:00:00.000Z' }

  it('keeps the second one when the form opened on it', () => {
    const draft = {
      ...draftAt('2019-10-27T01:40:00.000Z'),
      title: 'Route coupée',
      producerKind: 'Agent SMMAR',
    }

    expect(judged(draft, night, [])).toMatchObject({
      report: { from: '2019-10-27T01:40:00.000Z' },
    })
  })

  it('sends back an event of that hour as it was when nothing is changed', () => {
    const event = aReport({
      id: 'c',
      from: '2019-10-27T01:10:00.000Z',
      to: '2019-10-27T01:40:00.000Z',
    })

    expect(judged(draftOf(event), night, [])).toMatchObject({
      report: { from: event.from, to: event.to },
    })
  })

  it('reads the end proposed after a start in the first one as following it', () => {
    const draft = aDraft({ from: '2019-10-27T02:50', to: '' })

    expect(judged({ ...draft, to: endOnEntry(draft) }, night, [])).toMatchObject({
      report: { from: '2019-10-27T00:50:00.000Z', to: '2019-10-27T01:05:00.000Z' },
    })
  })
})

describe('where a refusal of the API lands', () => {
  it('is beside the field it names, and under the form otherwise', () => {
    expect(
      placed([
        { path: 'title', message: 'must not carry control characters' },
        { path: 'link', message: 'must be an http or https address' },
        { path: 'position.coordinates.0', message: 'is not closed' },
        { path: 'media', message: 'names a photo twice' },
      ]),
    ).toEqual({
      fields: {
        title: 'must not carry control characters',
        link: 'must be an http or https address',
        position: 'is not closed',
      },
      rest: ['media : names a photo twice'],
    })
  })
})

describe('what is left to correct, beside the button', () => {
  it('names the refused fields, in the order the form shows them', () => {
    expect(toCorrect({ photos: '…', title: '…', from: '…' })).toBe(
      'À corriger : Titre, Début, Photos.',
    )
  })

  it('says nothing once nothing is refused', () => {
    expect(toCorrect({})).toBeUndefined()
  })
})

describe('whether leaving the form loses anything', () => {
  const blank = aDraft()

  it('loses nothing of a form nobody typed into', () => {
    expect(touched(blank, blank, 0)).toBe(false)
  })

  it('loses what was typed, or a photo chosen', () => {
    expect(touched(aDraft({ title: 'Autre' }), blank, 0)).toBe(true)
    expect(touched(blank, blank, 1)).toBe(true)
  })
})
