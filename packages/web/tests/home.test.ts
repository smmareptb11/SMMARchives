import { describe, expect, it } from 'vitest'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { PHENOMENA, SEVERITIES } from '../src/about.ts'
import { entriesOf, entryOf, galleryOf, withoutReplay } from '../src/home/entries.ts'
import { isPlainClick, nextAfterSignIn, routeOf, signInPath } from '../src/routing.ts'

const manifest = {
  schemaVersion: 1,
  id: 'c4a7c5be-73d0-48db-aa17-8be7b314f863',
  label: "Crue de l'Aude, octobre 2019",
  extent: null,
  period: { from: '2019-10-22T04:00:00.000Z', to: '2019-10-23T04:00:00.000Z' },
  createdAt: '2026-09-12T08:00:00.000Z',
  updatedAt: '2026-09-12T08:00:00.000Z',
  state: 'complete',
  lanes: {},
  datasets: {},
  media: { copied: 0, failed: 0, bytes: 0 },
} satisfies ReplayManifest

const aReport = () => ({
  ranAt: '2026-09-12T08:00:00.000Z',
  request: {},
  sourcesWithoutData: [],
  fallbacks: [],
  failures: [],
})

describe('a line of the replay list', () => {
  it('links to the replay by the identifier the database minted', () => {
    expect(entryOf(manifest).href).toBe('/rejeux/c4a7c5be-73d0-48db-aa17-8be7b314f863')
  })

  it('names a replay without a label rather than leaving it blank', () => {
    expect(entryOf({ ...manifest, label: null }).title).toBe('Rejeu sans titre')
  })

  it('names a replay whose label is blank, which the API accepts', () => {
    expect(entryOf({ ...manifest, label: '' }).title).toBe('Rejeu sans titre')
    expect(entryOf({ ...manifest, label: '   ' }).title).toBe('Rejeu sans titre')
  })

  it('says the period in French time', () => {
    expect(entryOf(manifest).period).toBe('du 22 au 23 octobre 2019')
  })

  it('says how long the period lasts', () => {
    expect(entryOf(manifest).duration).toBe('1 jour')
  })

  it('says whether it covers the whole territory, a union or a reduced extent', () => {
    expect(entryOf(manifest).extent).toBe('Tout le territoire')
    const extent = { minLon: 2.1, minLat: 43.1, maxLon: 2.5, maxLat: 43.3 }
    expect(entryOf({ ...manifest, extent, territory: 'Aude Centre' }).extent).toBe('Aude Centre')
    expect(entryOf({ ...manifest, extent }).extent).toBe('Emprise réduite')
  })

  it('says the period across the October clock change in French time', () => {
    // An hour apart in UTC, and both 02:30 on a Paris clock: summer time, then
    // winter time.
    const { period } = entryOf({
      ...manifest,
      period: {
        from: '2019-10-27T00:30:00.000Z',
        to: '2019-10-27T01:30:00.000Z',
      },
    })
    expect(period).toBe('le 27 octobre 2019 de 2 h 30 à 2 h 30')
  })

  it('says each state in French', () => {
    const states = (['running', 'complete', 'partial', 'failed'] as const).map(
      (state) => entryOf({ ...manifest, state }).stateLabel,
    )
    expect(states).toEqual(['En cours', 'Complet', 'Partiel', 'Échoué'])
  })

  it('keeps the order the API gave', () => {
    const ids = entriesOf([
      { ...manifest, id: 'older', createdAt: '2026-09-01T00:00:00.000Z' },
      { ...manifest, id: 'newer', createdAt: '2026-09-20T00:00:00.000Z' },
    ]).map((entry) => entry.id)
    expect(ids).toEqual(['older', 'newer'])
  })

  it('says whether everyone sees it', () => {
    expect(entryOf(manifest).public).toBe(false)
    expect(entryOf({ ...manifest, publishedAt: '2026-09-12T22:30:00.000Z' }).public).toBe(true)
  })
})

describe('what a card says the administrator said of it', () => {
  it('names the phenomenon and the severity in French', () => {
    const entry = entryOf({
      ...manifest,
      phenomenon: 'intense-rainfall',
      severity: 'reinforced-alert',
    })

    expect(entry.phenomenon).toBe('Orage / pluie intense')
    expect(entry.severity).toEqual({ level: 'reinforced-alert', label: 'Alerte renforcée' })
  })

  it('keeps the description as it was written, line breaks included', () => {
    const description = 'Débordement à Trèbes.\nRoute coupée la nuit.'

    expect(entryOf({ ...manifest, description }).description).toBe(description)
  })

  it('says nothing of what was not said', () => {
    const entry = entryOf(manifest)

    expect([entry.phenomenon, entry.severity, entry.description]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe('the choices the creation offers', () => {
  it('lists every phenomenon in French', () => {
    expect(PHENOMENA.map((one) => one.label)).toEqual([
      'Crue',
      'Orage / pluie intense',
      'Ruissellement',
      'Submersion marine',
      'Tempête',
      'Autre',
    ])
  })

  it("lists the SMMAR's ladder, lowest first", () => {
    expect(SEVERITIES.map((one) => one.label)).toEqual([
      'Vigilance',
      'Alerte',
      'Alerte renforcée',
      'Crise',
    ])
  })
})

describe('the figures of a card', () => {
  const counted = {
    ...manifest,
    fleet: {
      hydro: { inExtent: 89, withMeasures: 49 },
      'rain-gauge': { inExtent: 254, withMeasures: 214 },
    },
    events: { crossings: 12, singleStep: 2, thresholdsSetAside: {} },
    media: { copied: 600, failed: 3, bytes: 0 },
    radarFrames: 3061,
    datasets: { 'webcam-images': { count: 10, report: aReport() } },
  } satisfies ReplayManifest

  it('counts each family that measured, the crossings, the radar images and the photos', () => {
    expect(entryOf(counted).figures).toEqual([
      '49 stations mesurées sur 89',
      '214 pluviomètres mesurés sur 254',
      '12 franchissements',
      // French groups thousands with a narrow no-break space.
      '3\u202f061 images radar',
      '10 photos de webcam',
    ])
  })

  it('writes a single one in the singular', () => {
    const one = {
      ...counted,
      fleet: {
        hydro: { inExtent: 1, withMeasures: 1 },
        'rain-gauge': { inExtent: 1, withMeasures: 1 },
      },
      events: { ...counted.events, crossings: 1 },
      radarFrames: 1,
      datasets: { 'webcam-images': { count: 1, report: aReport() } },
    }
    expect(entryOf(one).figures).toEqual([
      '1 station mesurée sur 1',
      '1 pluviomètre mesuré sur 1',
      '1 franchissement',
      '1 image radar',
      '1 photo de webcam',
    ])
  })

  it('leaves out a family the replay holds none of', () => {
    const noGauge = {
      ...counted,
      fleet: { ...counted.fleet, 'rain-gauge': { inExtent: 0, withMeasures: 0 } },
    }
    expect(entryOf(noGauge).figures[1]).toBe('12 franchissements')
  })

  it('leaves out what the replay holds none of', () => {
    const none = {
      ...counted,
      fleet: {
        hydro: { inExtent: 89, withMeasures: 0 },
        'rain-gauge': { inExtent: 254, withMeasures: 214 },
      },
      events: { ...counted.events, crossings: 0 },
      radarFrames: 0,
      datasets: { 'webcam-images': { count: 0, report: aReport() } },
    }
    expect(entryOf(none).figures).toEqual(['214 pluviomètres mesurés sur 254'])
  })

  it('leaves out what the manifest does not hold rather than writing 0', () => {
    expect(entryOf(manifest).figures).toEqual([])
  })

  it('shows none while the replay is being built', () => {
    expect(entryOf({ ...counted, state: 'running' }).figures).toEqual([])
  })
})

describe('the gallery', () => {
  const PUBLISHED = '2026-09-13T08:00:00.000Z'

  it('sets the published replays apart from those in preparation', () => {
    const gallery = galleryOf([
      { ...manifest, id: 'published', publishedAt: PUBLISHED },
      { ...manifest, id: 'complete' },
      { ...manifest, id: 'running', state: 'running' },
      { ...manifest, id: 'failed', state: 'failed' },
    ])
    expect(gallery.published.map((entry) => entry.id)).toEqual(['published'])
    expect(gallery.preparing.map((entry) => entry.id)).toEqual(['complete', 'running', 'failed'])
  })

  it('keeps the order the API gave within each section', () => {
    const gallery = galleryOf([
      { ...manifest, id: 'first', publishedAt: PUBLISHED },
      { ...manifest, id: 'second' },
      { ...manifest, id: 'third', publishedAt: PUBLISHED },
      { ...manifest, id: 'fourth' },
    ])
    expect(gallery.published.map((entry) => entry.id)).toEqual(['first', 'third'])
    expect(gallery.preparing.map((entry) => entry.id)).toEqual(['second', 'fourth'])
  })
})

describe('the gallery once a replay is removed', () => {
  const gallery = galleryOf([
    { ...manifest, id: 'public', publishedAt: '2026-09-13T08:00:00.000Z' },
    { ...manifest, id: 'kept' },
    { ...manifest, id: 'preparing' },
  ])
  const ids = (one: ReturnType<typeof galleryOf>) => ({
    published: one.published.map((entry) => entry.id),
    preparing: one.preparing.map((entry) => entry.id),
  })

  it('loses a published replay, and keeps the others in their order', () => {
    expect(ids(withoutReplay(gallery, 'public'))).toEqual({
      published: [],
      preparing: ['kept', 'preparing'],
    })
  })

  it('loses a replay in preparation, and keeps the others in their order', () => {
    expect(ids(withoutReplay(gallery, 'kept'))).toEqual({
      published: ['public'],
      preparing: ['preparing'],
    })
  })

  it('is unchanged by an identifier it does not hold', () => {
    expect(ids(withoutReplay(gallery, 'elsewhere'))).toEqual(ids(gallery))
  })
})

describe('the address of a screen', () => {
  it('opens the list at the root', () => {
    expect(routeOf('/')).toEqual({ screen: 'home' })
  })

  it('opens the creation on its own address', () => {
    expect(routeOf('/nouveau')).toEqual({ screen: 'creation' })
    expect(routeOf('/nouveau/')).toEqual({ screen: 'creation' })
  })

  it('opens the sign-in on its own address, whatever it leads to', () => {
    expect(routeOf('/connexion')).toEqual({ screen: 'signIn' })
    expect(routeOf('/connexion/')).toEqual({ screen: 'signIn' })
  })

  it('opens a replay by its identifier', () => {
    expect(routeOf('/rejeux/abc-123')).toEqual({
      screen: 'replay',
      id: 'abc-123',
    })
  })

  it('reads a replay named like the creation as a replay', () => {
    expect(routeOf('/rejeux/nouveau')).toEqual({
      screen: 'replay',
      id: 'nouveau',
    })
  })

  it('falls back on the list for an address it does not know', () => {
    expect(routeOf('/ailleurs')).toEqual({ screen: 'home' })
  })
})

describe('where the sign-in leads', () => {
  it('back to the screen it was opened from', () => {
    const { search } = new URL(signInPath('/rejeux/abc-123'), 'http://smmarchives.test')
    expect(nextAfterSignIn(search)).toBe('/rejeux/abc-123')
  })

  it('to the list when it was given nowhere to go', () => {
    expect(nextAfterSignIn('')).toBe('/')
    expect(nextAfterSignIn('?suite=')).toBe('/')
  })

  it.each(['https://ailleurs.test/', '//ailleurs.test/', '/\\ailleurs.test/', 'rejeux/abc-123'])(
    'to the list rather than to %s, which is not a path of this site',
    (next) => {
      expect(nextAfterSignIn(`?${new URLSearchParams({ suite: next }).toString()}`)).toBe('/')
    },
  )
})

describe('a click on a link', () => {
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  }

  it('is followed in place when plain', () => {
    expect(isPlainClick(plain)).toBe(true)
  })

  it('is left to the browser when it asks for a new tab or window', () => {
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false)
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false)
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false)
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false)
  })
})
