import { describe, expect, it } from 'vitest'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { entriesOf, entryOf } from '../src/home/entries.ts'
import { isPlainClick, routeOf } from '../src/routing.ts'

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
  media: { copied: 0, skipped: 0, failed: 0, bytes: 0 },
} satisfies ReplayManifest

describe('a line of the replay list', () => {
  it('links to the replay by the identifier the database minted', () => {
    expect(entryOf(manifest).href).toBe('/rejeux/c4a7c5be-73d0-48db-aa17-8be7b314f863')
  })

  it('names a replay without a label rather than leaving it blank', () => {
    expect(entryOf({ ...manifest, label: null }).title).toBe('Rejeu sans titre')
  })

  it('says the period in French time', () => {
    const { period } = entryOf(manifest)
    expect(period).toContain('22/10/2019')
    expect(period).toContain('06:00')
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
    expect(period.match(/02:30/g)).toHaveLength(2)
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
})

describe('the address of a screen', () => {
  it('opens the list at the root', () => {
    expect(routeOf('/')).toEqual({ screen: 'home' })
  })

  it('opens the creation on its own address', () => {
    expect(routeOf('/nouveau')).toEqual({ screen: 'creation' })
    expect(routeOf('/nouveau/')).toEqual({ screen: 'creation' })
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
