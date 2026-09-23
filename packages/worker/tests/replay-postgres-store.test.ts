import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Pool } from 'pg'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Measure, ReplayIdentity } from '@smmarchives/shared'

import { openPostgresCatalog, type PostgresCatalog } from '../src/replay/postgres/catalog.ts'
import type { ReplayStore, StoredBlob } from '../src/replay/store.ts'
import { closeDatabase, freshDatabase } from './support/database.ts'

afterAll(closeDatabase)

const identity: Omit<ReplayIdentity, 'id'> = {
  label: "Crue de l'Aude, octobre 2019",
  extent: { minLon: 2.0, minLat: 42.7, maxLon: 3.2, maxLat: 43.6 },
  period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
}

const MEASURES: Measure[] = [
  { sourceId: 84, quantity: 'level', at: '2019-10-22T06:00:00.000Z', value: 1.25 },
]

async function bytesOf(blob: StoredBlob): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of blob.body) chunks.push(chunk as Uint8Array)
  return Buffer.concat(chunks)
}

describe('a replay in the database', () => {
  let pool: Pool
  let mediaRoot: string
  let catalog: PostgresCatalog

  beforeEach(async () => {
    pool = await freshDatabase('test_store')
    mediaRoot = await mkdtemp(join(tmpdir(), 'smmarchives-media-'))
    catalog = openPostgresCatalog({ pool, mediaRoot })
  })

  afterEach(async () => {
    await rm(mediaRoot, { recursive: true, force: true })
  })

  it('is created with an identifier nobody supplied', async () => {
    const { id } = await catalog.create(identity)

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('carries the identity it was created with', async () => {
    const { store } = await catalog.create(identity)

    const manifest = await store.getManifest()
    expect(manifest?.label).toBe(identity.label)
    expect(manifest?.extent).toEqual(identity.extent)
    expect(manifest?.period).toEqual(identity.period)
    expect(manifest?.state).toBe('running')
  })

  it('gives two creations two identifiers', async () => {
    const one = await catalog.create(identity)
    const other = await catalog.create(identity)

    expect(one.id).not.toBe(other.id)
  })

  it('answers undefined for a replay nobody created', async () => {
    expect(await catalog.open(randomUUID())).toBeUndefined()
  })

  it('answers undefined for a name it could never have minted', async () => {
    expect(await catalog.open('aude-2019-10')).toBeUndefined()
  })

  it('lists the replays it holds, newest first', async () => {
    const older = await catalog.create({ ...identity, label: 'older' })
    await olderBy(pool, older.id, '2026-09-01T08:00:00Z')
    await catalog.create({ ...identity, label: 'newer' })

    expect((await catalog.list()).map((one) => one.label)).toEqual(['newer', 'older'])
  })

  it('reads back a data set the way a re-run needs it', async () => {
    const { store } = await catalog.create(identity)
    await store.putDataset('measures', MEASURES)

    expect(await store.getDataset('measures')).toEqual(MEASURES)
  })

  it('serves a data set as bytes, for a reader that does not decode', async () => {
    const { store } = await catalog.create(identity)
    await store.putDataset('measures', MEASURES)

    const blob = await opened(store)
    expect(JSON.parse((await bytesOf(blob)).toString('utf8'))).toEqual(MEASURES)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('changes the version of a data set a re-run rewrote', async () => {
    const { store } = await catalog.create(identity)
    await store.putDataset('measures', MEASURES)
    const before = (await opened(store)).version

    await store.putDataset('measures', [{ ...MEASURES[0]!, value: 9.99 }])
    expect((await opened(store)).version).not.toBe(before)
  })

  it('keeps the bytes it froze on the volume, not in the database', async () => {
    const { id, store } = await catalog.create(identity)
    await store.putMedia('webcams/215/1571724000.jpg', new Uint8Array([0xff, 0xd8, 0x00, 0x80]))

    const path = join(mediaRoot, id, 'webcams/215/1571724000.jpg')
    expect([...(await readFile(path))]).toEqual([0xff, 0xd8, 0x00, 0x80])
  })

  it('reads a frozen medium back byte for byte', async () => {
    const { store } = await catalog.create(identity)
    await store.putMedia('radar/20034/pluvio5mn/1.png', new Uint8Array([1, 2, 3]))

    const blob = await store.openMedia('radar/20034/pluvio5mn/1.png')
    expect(blob === undefined ? undefined : [...(await bytesOf(blob))]).toEqual([1, 2, 3])
  })

  it('answers undefined for a medium the replay never froze', async () => {
    const { store } = await catalog.create(identity)

    expect(await store.openMedia('webcams/215/never.jpg')).toBeUndefined()
  })

  it('refuses a medium that would land outside the replay', async () => {
    const { store } = await catalog.create(identity)

    await expect(store.putMedia('../escaped.jpg', new Uint8Array([1]))).rejects.toThrow(/outside/)
  })

  it('knows a medium is already there, so a re-run does not fetch it again', async () => {
    const { store } = await catalog.create(identity)
    await store.putMedia('webcams/215/1.jpg', new Uint8Array([1]))

    expect(await store.hasMedia('webcams/215/1.jpg')).toBe(true)
    expect(await store.hasMedia('webcams/215/2.jpg')).toBe(false)
  })

  it('takes rows and bytes away together', async () => {
    const { id, store } = await catalog.create(identity)
    await store.putDataset('measures', MEASURES)
    await store.putMedia('webcams/215/1.jpg', new Uint8Array([1]))

    expect(await catalog.remove(id)).toBe(true)
    expect(await catalog.open(id)).toBeUndefined()
    expect(existsSync(join(mediaRoot, id))).toBe(false)
  })

  it('answers that there was none rather than pretending it removed one', async () => {
    expect(await catalog.remove(randomUUID())).toBe(false)
  })

  async function opened(store: ReplayStore): Promise<StoredBlob> {
    const blob = await store.openDataset('measures')
    if (blob === undefined) throw new Error('nothing stored a measures data set')
    return blob
  }
})

/** Ages a replay, since two creations in one test share a millisecond. */
async function olderBy(pool: Pool, id: string, at: string): Promise<void> {
  await pool.query('update replay set created_at = $2 where id = $1', [id, at])
}
