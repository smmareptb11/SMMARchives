import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { Pool } from 'pg'
import { expect } from 'vitest'

import type {
  DatasetName,
  DatasetStatus,
  JournalEntry,
  Report,
  ReplayManifest,
} from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import { openPostgresCatalog } from '@smmarchives/worker/replay/postgres/catalog.ts'
import { writeManifest } from '@smmarchives/worker/replay/postgres/manifest.ts'
import { openPostgresStore } from '@smmarchives/worker/replay/postgres/store.ts'
import { openPostgresSessionStore } from '@smmarchives/worker/session/postgres.ts'
import type { ReplayStore } from '@smmarchives/worker/replay/store.ts'

import { createApp, type ApiOptions } from '../../src/app.ts'
import type { BuildLauncher } from '../../src/builds.ts'
import { closeDatabase, freshDatabase, withDatabase } from './database.ts'
import { anAuth, asAdmin } from './session.ts'

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
    // Published, so a test reads it as anyone would; one about the
    // administrator's view leaves it out.
    publishedAt: '2026-09-10T06:20:00.000Z',
    lanes: { 'radar-rainfall': { state: 'done' } },
    datasets: {},
    media: { copied: 0, failed: 0, bytes: 0 },
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

  for (const [name, data] of Object.entries(held.datasets ?? {}) as [DatasetName, unknown][]) {
    await store.putDataset(name, data, reportOf(manifest, name))
  }
  for (const [path, body] of Object.entries(held.media ?? {})) {
    await store.putMedia(path, new TextEncoder().encode(body))
  }
  for (const entry of held.journal ?? []) await store.appendJournal(entry)

  // The manifest again: storing a data set moves `updatedAt`, and a test that
  // asserts on what it published must get what it published.
  await writeManifest(api.pool, manifest)
  await publishAsWritten(api, manifest)
}

/**
 * Set by hand: the store stamps a publication with its own clock, and a test
 * that asserts on the manifest must get the instant it wrote.
 */
async function publishAsWritten(api: Api, manifest: ReplayManifest): Promise<void> {
  await api.pool.query('update replay set published_at = $2 where id = $1', [
    manifest.id,
    manifest.publishedAt ?? null,
  ])
}

function reportOf(manifest: ReplayManifest, name: DatasetName): Report {
  const status = manifest.datasets[name]
  if (status === undefined) throw new Error(`the manifest holds no ${name} data set to store`)
  return status.report
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
export function appOn(api: Api, options: Partial<Omit<ApiOptions, 'catalog'>> = {}) {
  return createApp({
    catalog: api.catalog,
    auth: anAuth(openPostgresSessionStore(api.pool)),
    launch: neverLaunches,
    ...options,
  })
}

/** A creation, as the signed-in administrator sends one. */
export function post(base: string, payload: unknown): Promise<Response> {
  return asAdmin(base, '/replays', {
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

/**
 * A catalogue whose replays start being built after they are first opened:
 * what a change finds when it checks the replay again before writing, once its
 * photos have arrived.
 */
export function buildingOnceOpened(catalog: ReplayCatalog): ReplayCatalog {
  let opened = 0
  return {
    ...catalog,
    open: async (id) => {
      const store = await catalog.open(id)
      opened += 1
      if (store === undefined || opened === 1) return store
      return {
        ...store,
        getManifest: async () => {
          const manifest = await store.getManifest()
          return manifest === undefined ? undefined : { ...manifest, state: 'running' }
        },
      }
    },
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
    openDataset: async () => undefined,
    putDataset: async () => {},
    getManifest: async () => aManifest(),
    putManifest: async () => {},
    publish: async () => false,
    unpublish: async () => {},
    abandon: async () => {},
    claim: async () => true,
    appendJournal: async () => {},
    readJournal: async () => [],
    openMedia: async () => undefined,
    putMedia: async () => {},
    removeMedia: async () => {},
    addManualEvent: async () => {
      throw new Error('this store adds no event')
    },
    getManualEvent: async () => undefined,
    updateManualEvent: async () => undefined,
    removeManualEvent: async () => undefined,
    ...overrides,
  }
}
