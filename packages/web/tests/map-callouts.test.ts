import { describe, expect, it } from 'vitest'

import { calloutOfCamera, calloutOfSource } from '../src/map/callouts.ts'
import { viewsOf } from '../src/pictures.ts'
import { aCamera, aCrossing, aThreshold, aView, at } from './support/content.ts'

describe('what a station says when it is clicked', () => {
  const events = [aCrossing({ sourceId: 4, crossing: aThreshold() })]
  const station = { kind: 'watercourse' as const, id: 4, name: 'Trèbes' }

  it('is its name and what it is', () => {
    const callout = calloutOfSource(events, station, at('2019-10-22T08:00:00.000Z'))

    expect(callout).toEqual({ title: 'Trèbes', lines: ["Station cours d'eau", 'Vigilance'] })
  })

  it('names an ouvrage an ouvrage, and says its threshold too', () => {
    const structure = { kind: 'structure' as const, id: 4, name: 'Seuil de Puichéric' }

    expect(calloutOfSource(events, structure, at('2019-10-22T08:00:00.000Z'))).toEqual({
      title: 'Seuil de Puichéric',
      lines: ['Ouvrage', 'Vigilance'],
    })
  })

  it('says nothing of a threshold another station is in', () => {
    const elsewhere = [aCrossing({ sourceId: 7, crossing: aThreshold({ label: 'Crise' }) })]

    expect(calloutOfSource(elsewhere, station, at('2019-10-22T08:00:00.000Z')).lines[1]).toBe(
      'Sous tous ses seuils à cet instant.',
    )
  })

  /** A rank compared across two stations means nothing, and nothing compares them. */
  it('is the threshold of the station clicked, and not the highest of the parc', () => {
    const parc = [
      aCrossing({ sourceId: 4, severity: 1, crossing: aThreshold() }),
      aCrossing({ sourceId: 7, severity: 3, crossing: aThreshold({ label: 'Crise' }) }),
    ]

    expect(calloutOfSource(parc, station, at('2019-10-22T08:00:00.000Z')).lines[1]).toBe(
      'Vigilance',
    )
  })

  /** The manual events to come carry no crossing, and their title is all they have. */
  it('is the title of an event an agent wrote, which is all such an event has', () => {
    const written = [
      aCrossing({
        sourceId: 4,
        origin: 'manual',
        title: 'Route coupée au pont de Trèbes',
        crossing: null,
      }),
    ]

    expect(calloutOfSource(written, station, at('2019-10-22T08:00:00.000Z')).lines).toEqual([
      "Station cours d'eau",
      'Route coupée au pont de Trèbes',
    ])
  })

  /** The event's own title opens with the station's name, already the heading. */
  it('is the label of the threshold it is in, and not the title of the event', () => {
    const titled = [aCrossing({ sourceId: 4, title: 'Trèbes — Vigilance', crossing: aThreshold() })]

    expect(calloutOfSource(titled, station, at('2019-10-22T08:00:00.000Z')).lines[1]).toBe(
      'Vigilance',
    )
  })

  it('is the highest of the thresholds it is in', () => {
    const two = [
      ...events,
      aCrossing({ sourceId: 4, crossing: aThreshold({ label: 'Crise' }), severity: 3 }),
    ]

    expect(calloutOfSource(two, station, at('2019-10-22T08:00:00.000Z')).lines[1]).toBe('Crise')
  })

  it('says it is under all of them once the crossing is over', () => {
    const callout = calloutOfSource(events, station, at('2019-10-22T18:00:00.000Z'))

    expect(callout.lines[1]).toBe('Sous tous ses seuils à cet instant.')
  })

  it('says when the water had not come back down at the last measurement', () => {
    const never = [aCrossing({ sourceId: 4, crossing: aThreshold({ stillActiveAtEnd: true }) })]

    expect(calloutOfSource(never, station, at('2019-10-22T08:00:00.000Z')).lines[1]).toBe(
      'Vigilance — pas redescendue à la dernière mesure du rejeu.',
    )
  })

  it('says when the nature of the threshold was assumed rather than read', () => {
    const guessed = [aCrossing({ sourceId: 4, crossing: aThreshold({ natureIsFallback: true }) })]

    expect(calloutOfSource(guessed, station, at('2019-10-22T08:00:00.000Z')).lines).toEqual([
      "Station cours d'eau",
      'Vigilance',
      'Nature du seuil supposée.',
    ])
  })
})

describe('what a rain gauge says when it is clicked', () => {
  it('is its name and its family, and nothing about thresholds', () => {
    const callout = calloutOfSource(
      [aCrossing({ sourceId: 4 })],
      { kind: 'rain-gauge', id: 4, name: 'Pezens' },
      at('2019-10-22T08:00:00.000Z'),
    )

    expect(callout).toEqual({ title: 'Pezens', lines: ['Pluviomètre'] })
  })
})

describe('what a camera says when it is clicked', () => {
  const camera = aCamera()
  const views = viewsOf([aView({ at: '2019-10-22T06:00:00.000Z' })])

  it('is its commune, and when the picture on the map was taken', () => {
    expect(calloutOfCamera(camera, views, at('2019-10-22T08:00:00.000Z'))).toEqual({
      title: 'Mailhac',
      lines: ['Webcam', 'Vue du 22/10/2019 08:00.'],
    })
  })

  it('says the camera had not looked yet, rather than nothing', () => {
    expect(calloutOfCamera(camera, views, at('2019-10-21T00:00:00.000Z')).lines[1]).toBe(
      'Aucune vue avant cet instant.',
    )
  })
})
