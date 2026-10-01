import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { Pool } from 'pg'
import { expect } from 'vitest'

import type { DatasetName, DatasetStatus, JournalEntry, ReplayManifest } from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import { openPostgresCatalog } from '@smmarchives/worker/replay/postgres/catalog.ts'
import { writeManifest } from '@smmarchives/worker/replay/postgres/manifest.ts'
import { openPostgresStore } from '@smmarchives/worker/replay/postgres/store.ts'
import type { ReplayStore } from '@smmarchives/worker/replay/store.ts'

import { createApp, type ApiOptions } from '../../src/app.ts'
import type { BuildLauncher } from '../../src/builds.ts'
import { closeDatabase, freshDatabase, withDatabase } from './database.ts'

export { closeDatabase, withDatabase }

/** What one test file needs: a schema of its own, and a volume of its own. */
export type Api = {
  pool: Pool
  mediaRoot: string
  catalog: ReplayCatalog
}

const roots = new Set<string>()

/**
 * A database and a media volume holding nothing.
 *
 * The schema is named after the test file, because Vitest runs files in
 * parallel and one emptying the tables another is reading would fail whichever
 * lost the race.
 */
export async function anApi(): Promise<Api> {
  const path = expect.getState().testPath ?? 'api'
  const schema = `test_${basename(path).replace(/\W/g, '_')}`
  const pool = await freshDatabase(schema)
  const mediaRoot = await mkdtemp(join(tmpdir(), 'smmarchives-api-'))
  roots.add(mediaRoot)

  return { pool, mediaRoot, catalog: openPostgresCatalog({ pool, mediaRoot }) }
}

/** For `afterEach`. Without it a run leaves one temporary volume per test. */
export async function cleanRoots(): Promise<void> {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.clear()
}

export function aManifest(overrides: Partial<ReplayManifest> = {}): ReplayManifest {
  return {
    schemaVersion: 1,
    // Minted here the way the database mints one, so a test can name the replay
    // it is about before it exists.
    id: crypto.randomUUID(),
    label: "Crue de l'Aude, octobre 2019",
    extent: null,
    period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
    createdAt: '2026-09-10T06:00:00.000Z',
    updatedAt: '2026-09-10T06:10:00.000Z',
    state: 'complete',
    lanes: { 'radar-rainfall': { state: 'done' } },
    datasets: {},
    media: { copied: 0, skipped: 0, failed: 0, bytes: 0 },
    ...overrides,
  }
}

/** Left to the store, so a fixture cannot drift from what a build writes. */
export async function writeReplay(
  api: Api,
  manifest: ReplayManifest,
  held: {
    datasets?: Partial<Record<DatasetName, unknown>>
    media?: Record<string, string>
    journal?: JournalEntry[]
  } = {},
): Promise<void> {
  await writeManifest(api.pool, manifest)
  const store = openPostgresStore({
    pool: api.pool,
    replayId: manifest.id,
    mediaRoot: api.mediaRoot,
  })

  for (const [name, data] of Object.entries(held.datasets ?? {})) {
    await store.putDataset(name as DatasetName, data)
  }
  for (const [path, body] of Object.entries(held.media ?? {})) {
    await store.putMedia(path, new TextEncoder().encode(body))
  }
  for (const entry of held.journal ?? []) await store.appendJournal(entry)

  // The manifest again: storing a data set moves `updatedAt`, and a test that
  // asserts on what it published must get what it published.
  await writeManifest(api.pool, manifest)
}

/** What a build records about a data set once it has stored it. */
export function aDataset(count: number): DatasetStatus {
  return {
    count,
    report: {
      ranAt: '2026-09-10T06:05:00.000Z',
      request: {},
      sourcesWithoutData: [],
      fallbacks: [],
      failures: [],
    },
  }
}

/** A manifest no store could have written, which is the point. */
export async function corruptManifest(api: Api, id: string): Promise<void> {
  await api.pool.query(`update replay set state = 'bizarre' where id = $1`, [id])
}

/**
 * An application over one test's database, and a launcher that launches nothing.
 *
 * The default matters: without it every app built here carries the real
 * `spawnBuild`, pointed at the real checkout and the real `.env`, and the
 * promise that no test starts a collection would rest on no test ever posting
 * one.
 */
export function appOn(api: Api, options: Omit<ApiOptions, 'catalog'> = {}) {
  return createApp({ catalog: api.catalog, launch: neverLaunches, ...options })
}

/** A creation, as a client sends one. */
export function post(base: string, payload: unknown): Promise<Response> {
  return fetch(`${base}/replays`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export const neverLaunches: BuildLauncher = () => ({ exited: NEVER_ENDS })

/**
 * A catalogue whose every method is there, so one added to the port breaks the
 * compilation here rather than in each test that forgot it.
 */
export function aCatalog(overrides: Partial<ReplayCatalog> = {}): ReplayCatalog {
  return {
    create: async () => {
      throw new Error('this catalogue creates nothing')
    },
    list: async () => [],
    open: async () => undefined,
    remove: async () => false,
    ...overrides,
  }
}

/** A build still running, whatever the test does next. */
export const NEVER_ENDS = new Promise<{ code: number | null; stderr: string }>(() => {})

/** The wire shape of an error, pinned here rather than imported from the source. */
export type Problem = { type: string; title: string; status: number; detail: string }

/**
 * A store whose every method is there, so a method added to the port breaks the
 * compilation here rather than passing through a cast.
 */
export function aStore(overrides: Partial<ReplayStore>): ReplayStore {
  return {
    getDataset: async () => undefined,
    openDataset: async () => undefined,
    putDataset: async () => {},
    getManifest: async () => aManifest(),
    putManifest: async () => {},
    appendJournal: async () => {},
    readJournal: async () => [],
    hasMedia: async () => false,
    openMedia: async () => undefined,
    putMedia: async () => {},
    ...overrides,
  }
}
