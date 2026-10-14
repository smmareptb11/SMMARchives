import { describe, expect, it } from 'vitest'

import {
  draftAt,
  endOnEntry,
  judged,
  PHOTO_COUNT_LIMIT,
  PHOTO_SIZE_LIMIT,
  placed,
  toCorrect,
  touched,
  type Draft,
} from '../src/events/draft.ts'
import { period } from './support/content.ts'

/** A draft that holds together, as the form spells it: French wall times. */
function aDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    title: 'Route coupée',
    producerKind: 'Agent SMMAR',
    from: '2019-10-22T08:00',
    to: '',
    description: '',
    position: null,
    ...overrides,
  }
}

const JPEG = { size: 1_000, type: 'image/jpeg' }

describe('a blank form', () => {
  it('starts where the reading stands, in French time', () => {
    expect(draftAt('2019-10-22T06:30:00.000Z')).toMatchObject({ from: '2019-10-22T08:30', to: '' })
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
        position: null,
      },
    })
  })

  it('keeps the description as typed, paragraphs included', () => {
    const verdict = judged(aDraft({ description: 'Pont submergé.\nDéviation.' }), period, [])

    expect(verdict).toMatchObject({ report: { description: 'Pont submergé.\nDéviation.' } })
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

describe('where a refusal of the API lands', () => {
  it('is beside the field it names, and under the form otherwise', () => {
    expect(
      placed([
        { path: 'title', message: 'must not carry control characters' },
        { path: 'position.coordinates.0', message: 'is not closed' },
        { path: 'media', message: 'names a photo twice' },
      ]),
    ).toEqual({
      fields: {
        title: 'must not carry control characters',
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
