import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import type { Report, ReplayManifest } from '@smmarchives/shared'

import { readManifest, writeManifest } from '../src/replay/postgres/manifest.ts'
import { closeDatabase, freshDatabase } from './support/database.ts'

afterAll(closeDatabase)

function aReport(extra: Record<string, unknown> = {}): Report {
  return {
    ranAt: '2026-09-11T08:05:00.000Z',
    request: {},
    sourcesWithoutData: [],
    fallbacks: [],
    failures: [],
    ...extra,
  }
}

function aManifest(overrides: Partial<ReplayManifest> = {}): ReplayManifest {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    label: "Crue de l'Aude, octobre 2019",
    extent: { minLon: 2.0, minLat: 42.7, maxLon: 3.2, maxLat: 43.6 },
    period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:10:00.000Z',
    state: 'complete',
    lanes: {
      aquasys: {
        state: 'done',
        startedAt: '2026-09-11T08:00:01.000Z',
        finishedAt: '2026-09-11T08:09:00.000Z',
      },
      lizmap: { state: 'failed', error: 'the host answered nothing' },
    },
    datasets: {},
    media: { copied: 12, skipped: 3, failed: 1, bytes: 4096 },
    ...overrides,
  }
}

describe('the manifest of a replay', () => {
  let pool: Pool

  beforeEach(async () => {
    pool = await freshDatabase('test_manifest')
  })

  it('is read back as it was published', async () => {
    const manifest = aManifest()
    await writeManifest(pool, manifest)

    expect(await readManifest(pool, manifest.id)).toEqual(manifest)
  })

  it('answers undefined for a replay nobody published', async () => {
    expect(await readManifest(pool, randomUUID())).toBeUndefined()
  })

  it('keeps an absent extent absent, which is the whole fleet', async () => {
    const manifest = aManifest({ extent: null })
    await writeManifest(pool, manifest)

    expect((await readManifest(pool, manifest.id))?.extent).toBeNull()
  })

  it('carries the transitions of every lane', async () => {
    const manifest = aManifest()
    await writeManifest(pool, manifest)

    const read = await readManifest(pool, manifest.id)
    expect(read?.lanes.lizmap).toEqual({ state: 'failed', error: 'the host answered nothing' })
  })

  it('replaces what a previous publication said', async () => {
    const manifest = aManifest({ state: 'running' })
    await writeManifest(pool, manifest)
    await writeManifest(pool, { ...manifest, state: 'partial', updatedAt: '2026-09-11T09:00:00Z' })

    expect((await readManifest(pool, manifest.id))?.state).toBe('partial')
  })

  it('counts what the tables hold rather than what it was told', async () => {
    const manifest = aManifest({
      datasets: { measures: { count: 0, report: aReport() } },
    })
    await writeManifest(pool, manifest)
    await pool.query(
      `insert into measure (replay_id, source_id, quantity, at, value) values
         ($1, '84', 'level', '2019-10-22T06:00:00Z', 1.25),
         ($1, '84', 'level', '2019-10-22T06:05:00Z', 1.31)`,
      [manifest.id],
    )

    expect((await readManifest(pool, manifest.id))?.datasets.measures?.count).toBe(2)
  })

  it('carries no fleet until a lane has collected a referential', async () => {
    const manifest = aManifest()
    await writeManifest(pool, manifest)

    expect((await readManifest(pool, manifest.id))?.fleet).toBeUndefined()
  })

  it('keeps the fleet the lane counted, which no query recounts', async () => {
    // `withMeasures` is summed per family by the lane, and a measure carries no
    // family: two sources sharing a number are two here, and one to a count.
    const manifest = aManifest({ fleet: { inExtent: 323, withMeasures: 96 } })
    await writeManifest(pool, manifest)

    expect((await readManifest(pool, manifest.id))?.fleet).toEqual({
      inExtent: 323,
      withMeasures: 96,
    })
  })

  it('rebuilds what the derivation implied from its own report', async () => {
    const manifest = aManifest({
      datasets: {
        events: {
          count: 0,
          report: aReport({ singleStep: 2, setAside: { 'flood-mark': 7 } }),
        },
      },
    })
    await writeManifest(pool, manifest)
    await pool.query(
      `insert into event (replay_id, id, origin, category, title, starts_at) values
         ($1, 'a', 'automatic', 'threshold-crossing', 'Vigilance à Trèbes', '2019-10-22T06:00:00Z')`,
      [manifest.id],
    )

    expect((await readManifest(pool, manifest.id))?.events).toEqual({
      crossings: 1,
      singleStep: 2,
      thresholdsSetAside: { 'flood-mark': 7 },
    })
  })
})
