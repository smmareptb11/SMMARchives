import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Pool } from 'pg'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ReplayManifest } from '@smmarchives/shared'

import { writeManifest } from '../src/replay/postgres/manifest.ts'
import { openPostgresStore } from '../src/replay/postgres/store.ts'
import { closeDatabase, freshDatabase } from './support/database.ts'

afterAll(closeDatabase)

function aManifest(overrides: Partial<ReplayManifest> = {}): ReplayManifest {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    label: "Crue de l'Aude, octobre 2019",
    extent: null,
    period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:10:00.000Z',
    state: 'complete',
    lanes: {},
    datasets: {},
    media: { copied: 0, failed: 0, bytes: 0 },
    ...overrides,
  }
}

describe('publishing a replay', () => {
  let pool: Pool
  let mediaRoot: string

  beforeEach(async () => {
    pool = await freshDatabase('test_publication')
    mediaRoot = await mkdtemp(join(tmpdir(), 'smmarchives-publication-'))
  })

  afterEach(async () => {
    await rm(mediaRoot, { recursive: true, force: true })
  })

  async function stored(manifest: ReplayManifest) {
    await writeManifest(pool, manifest)
    return openPostgresStore({ pool, replayId: manifest.id, mediaRoot })
  }

  it('is unpublished until someone publishes it', async () => {
    const store = await stored(aManifest())
    expect((await store.getManifest())?.publishedAt).toBeUndefined()
  })

  it('stamps a complete replay with the moment it was opened to everyone', async () => {
    const store = await stored(aManifest())
    // The database's clock, which is the one that stamps it.
    const before = (await pool.query<{ at: string }>('select now() as at')).rows[0]?.at ?? ''

    expect(await store.publish()).toBe(true)
    const publishedAt = (await store.getManifest())?.publishedAt ?? ''
    expect(publishedAt >= before).toBe(true)
  })

  it.each(['running', 'partial', 'failed'] as const)(
    'refuses a %s replay, and leaves it unpublished',
    async (state) => {
      const store = await stored(aManifest({ state }))

      expect(await store.publish()).toBe(false)
      expect((await store.getManifest())?.publishedAt).toBeUndefined()
    },
  )

  it('keeps the first date when published twice', async () => {
    const store = await stored(aManifest())
    await store.publish()
    const first = (await store.getManifest())?.publishedAt

    expect(await store.publish()).toBe(true)
    expect((await store.getManifest())?.publishedAt).toBe(first)
  })

  it('withdraws it', async () => {
    const store = await stored(aManifest())
    await store.publish()
    await store.unpublish()

    expect((await store.getManifest())?.publishedAt).toBeUndefined()
  })

  it('is left as it was when the manifest is written again', async () => {
    const manifest = aManifest()
    const store = await stored(manifest)
    await store.publish()
    const published = (await store.getManifest())?.publishedAt

    await store.putManifest({ ...manifest, updatedAt: '2026-09-11T09:00:00.000Z' })
    expect((await store.getManifest())?.publishedAt).toBe(published)
  })
})

describe('abandoning a replay', () => {
  let pool: Pool
  let mediaRoot: string

  beforeEach(async () => {
    pool = await freshDatabase('test_publication')
    mediaRoot = await mkdtemp(join(tmpdir(), 'smmarchives-abandon-'))
  })

  afterEach(async () => {
    await rm(mediaRoot, { recursive: true, force: true })
  })

  async function stored(manifest: ReplayManifest) {
    await writeManifest(pool, manifest)
    return openPostgresStore({ pool, replayId: manifest.id, mediaRoot })
  }

  it('fails a replay its build left running', async () => {
    const store = await stored(aManifest({ state: 'running' }))

    await store.abandon()

    expect((await store.getManifest())?.state).toBe('failed')
  })

  it('goes to one of two builds that claim it together', async () => {
    const store = await stored(aManifest({ state: 'running' }))

    const claims = await Promise.all([store.claim(), store.claim()])

    expect(claims.sort()).toEqual([false, true])
    expect(await store.claim()).toBe(false)
  })

  it.each(['complete', 'partial'] as const)(
    'leaves a %s replay as its build settled it',
    async (state) => {
      const store = await stored(aManifest({ state }))

      await store.abandon()

      expect((await store.getManifest())?.state).toBe(state)
    },
  )
})
