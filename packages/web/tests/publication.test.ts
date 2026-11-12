import { describe, expect, it } from 'vitest'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { publicationOf, withPublication } from '../src/publication.ts'

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

describe("a replay's publication", () => {
  it('offers to make a complete replay public', () => {
    expect(publicationOf(manifest)).toEqual({
      status: 'Privé',
      action: 'publish',
      label: 'Rendre public',
      refusal: undefined,
    })
  })

  it.each(['running', 'partial', 'failed'] as const)(
    'turns making a %s replay public off, and says why',
    (state) => {
      const publication = publicationOf({ ...manifest, state })
      expect(publication.action).toBe('publish')
      expect(publication.refusal).toBe('Seul un rejeu complet peut être rendu public.')
    },
  )

  it('offers to make a public one private, and says no date', () => {
    expect(publicationOf({ ...manifest, publishedAt: '2026-09-12T22:30:00.000Z' })).toEqual({
      status: 'Public',
      action: 'withdraw',
      label: 'Rendre privé',
      refusal: undefined,
    })
  })
})

describe('a publication held apart from the manifest', () => {
  it('dates a manifest as published', () => {
    expect(withPublication(manifest, '2026-09-13T08:00:00.000Z').publishedAt).toBe(
      '2026-09-13T08:00:00.000Z',
    )
  })

  it('leaves no date on a manifest withdrawn', () => {
    const withdrawn = withPublication(
      { ...manifest, publishedAt: '2026-09-13T08:00:00.000Z' },
      undefined,
    )
    expect('publishedAt' in withdrawn).toBe(false)
  })

  it('keeps the data sets it was given, so nothing is read again', () => {
    expect(withPublication(manifest, '2026-09-13T08:00:00.000Z').datasets).toBe(manifest.datasets)
  })
})
