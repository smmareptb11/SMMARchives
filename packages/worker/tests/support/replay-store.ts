import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { expect } from 'vitest'

import type { ReplayIdentity } from '@smmarchives/shared'

import { openPostgresCatalog } from '../../src/replay/postgres/catalog.ts'
import type { ReplayStore, StoredBlob } from '../../src/replay/store.ts'
import { freshDatabase } from './database.ts'

export type StoredReplay = {
  id: string
  store: ReplayStore
  /** The volume its bytes land on, for a test that looks at them. */
  mediaRoot: string
}

const roots = new Set<string>()

/**
 * A replay a lane can build into: a row in a schema of this test file's own,
 * and a volume of its own for the bytes.
 */
export async function aStoredReplay(identity: Omit<ReplayIdentity, 'id'>): Promise<StoredReplay> {
  const path = expect.getState().testPath ?? 'worker'
  const pool = await freshDatabase(`test_${basename(path).replace(/\W/g, '_')}`)
  const mediaRoot = await mkdtemp(join(tmpdir(), 'smmarchives-media-'))
  roots.add(mediaRoot)

  const { id, store } = await openPostgresCatalog({ pool, mediaRoot }).create(identity)
  return { id, store, mediaRoot }
}

/** For `afterEach`. Without it a run leaves one temporary volume per test. */
export async function cleanMedia(): Promise<void> {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.clear()
}

/** The bytes of a frozen medium, or undefined if the replay never froze it. */
export async function frozenBytes(store: ReplayStore, path: string): Promise<Buffer | undefined> {
  const blob = await store.openMedia(path)
  return blob === undefined ? undefined : bytesOf(blob)
}

export async function bytesOf(blob: StoredBlob): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of blob.body) chunks.push(chunk as Uint8Array)
  return Buffer.concat(chunks)
}
