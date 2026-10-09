import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Pool } from 'pg'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Measure, ReplayEvent, ReplayIdentity } from '@smmarchives/shared'

import { openPostgresCatalog, type PostgresCatalog } from '../src/replay/postgres/catalog.ts'
import type { ManualEvent, ReplayStore, StoredBlob } from '../src/replay/store.ts'
import { closeDatabase, freshDatabase } from './support/database.ts'
import { aReport } from './support/replay-store.ts'

afterAll(closeDatabase)

const identity: Omit<ReplayIdentity, 'id'> = {
  label: "Crue de l'Aude, octobre 2019",
  extent: { minLon: 2.0, minLat: 42.7, maxLon: 3.2, maxLat: 43.6 },
  period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
}

const MEASURES: Measure[] = [
  { sourceId: 84, quantity: 'level', at: '2019-10-22T06:00:00.000Z', value: 1.25 },
]

const REPORT = aReport()

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
    await store.putDataset('measures', MEASURES, REPORT)

    expect(await store.getDataset('measures')).toEqual(MEASURES)
  })

  it('shows a data set in the manifest with its report from the moment it is stored', async () => {
    const { store } = await catalog.create(identity)
    await store.putDataset('measures', MEASURES, REPORT)

    const manifest = await store.getManifest()
    expect(manifest?.datasets['measures']).toEqual({ count: 1, report: REPORT })
  })

  it('serves a data set as bytes, for a reader that does not decode', async () => {
    const { store } = await catalog.create(identity)
    await store.putDataset('measures', MEASURES, REPORT)

    const blob = await opened(store)
    expect(JSON.parse((await bytesOf(blob)).toString('utf8'))).toEqual(MEASURES)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('changes the version of a data set a re-run rewrote', async () => {
    const { store } = await catalog.create(identity)
    await store.putDataset('measures', MEASURES, REPORT)
    const before = (await opened(store)).version

    await store.putDataset('measures', [{ ...MEASURES[0]!, value: 9.99 }], REPORT)
    expect((await opened(store)).version).not.toBe(before)
  })

  it('shows the report of the run that rewrote a data set, not the first one', async () => {
    const { store } = await catalog.create(identity)
    await store.putDataset('measures', MEASURES, REPORT)

    const rerun = aReport({ ranAt: '2026-09-12T08:05:00.000Z' })
    await store.putDataset('measures', MEASURES, rerun)
    expect((await store.getManifest())?.datasets['measures']?.report).toEqual(rerun)
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
    await store.putDataset('measures', MEASURES, REPORT)
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

const WRITTEN: ManualEvent = {
  title: 'D118 coupée à Couffoulens',
  description: 'Route inondée sur 200 m.',
  from: '2019-10-22T09:00:00.000Z',
  to: null,
  position: { lon: 2.3167, lat: 43.1583 },
  provenance: 'municipality',
}

describe('an event an agent wrote', () => {
  let pool: Pool
  let mediaRoot: string
  let catalog: PostgresCatalog

  beforeEach(async () => {
    pool = await freshDatabase('test_store_events')
    mediaRoot = await mkdtemp(join(tmpdir(), 'smmarchives-media-'))
    catalog = openPostgresCatalog({ pool, mediaRoot })
  })

  afterEach(async () => {
    await rm(mediaRoot, { recursive: true, force: true })
  })

  it('is read back with the events, under an identifier the database minted', async () => {
    const { store } = await catalog.create(identity)

    const added = await store.addManualEvent(WRITTEN)
    expect(added).toMatchObject({ ...WRITTEN, origin: 'manual', category: 'report', media: [] })
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await store.getDataset('events')).toEqual([added])
  })

  it('makes the events a data set of a replay that derived none', async () => {
    const { store } = await catalog.create(identity)
    await store.addManualEvent(WRITTEN)

    expect((await store.getManifest())?.datasets.events?.count).toBe(1)
    expect(await store.openDataset('events')).toBeDefined()
  })

  it('moves the version of the events, so a reader fetches them again', async () => {
    const { store } = await catalog.create(identity)
    await store.putDataset('events', [], aReport({ singleStep: 0, setAside: {} }))
    const before = (await store.openDataset('events'))?.version

    await store.addManualEvent(WRITTEN)
    expect((await store.openDataset('events'))?.version).not.toBe(before)
  })

  it('keeps the report of the derivation it was added beside', async () => {
    const { id, store } = await catalog.create(identity)
    await pool.query(
      `insert into replay_lane (replay_id, name, state) values ($1, 'events', 'done')`,
      [id],
    )
    await store.putDataset('events', [], aReport({ singleStep: 3, setAside: {} }))

    await store.addManualEvent(WRITTEN)
    expect((await store.getManifest())?.events?.singleStep).toBe(3)
  })

  it('holds the medium attached to it', async () => {
    const { store } = await catalog.create(identity)
    const added = await store.addManualEvent(WRITTEN)

    expect(await store.attachEventMedia(added.id, `manual/${added.id}/photo.jpg`)).toBe(true)
    expect(((await store.getDataset('events')) as ReplayEvent[])[0]?.media).toEqual([
      `manual/${added.id}/photo.jpg`,
    ])
  })

  it('refuses a second medium, which would replace an address served for good', async () => {
    const { store } = await catalog.create(identity)
    const added = await store.addManualEvent(WRITTEN)
    await store.attachEventMedia(added.id, `manual/${added.id}/one.jpg`)

    expect(await store.attachEventMedia(added.id, `manual/${added.id}/two.jpg`)).toBe(false)
  })

  it('refuses a medium on an event the derivation produced', async () => {
    const { id, store } = await catalog.create(identity)
    await pool.query(
      `insert into event (replay_id, id, origin, category, title, starts_at)
       values ($1, 'crossing', 'automatic', 'threshold-crossing', 'Vigilance', now())`,
      [id],
    )

    expect(await store.attachEventMedia('crossing', 'manual/crossing/one.jpg')).toBe(false)
  })

  it('reads one event by its identifier, and none it does not hold', async () => {
    const { store } = await catalog.create(identity)
    const added = await store.addManualEvent(WRITTEN)

    expect(await store.getEvent(added.id)).toEqual(added)
    expect(await store.getEvent(randomUUID())).toBeUndefined()
  })

  it('refuses a medium on an event nobody wrote', async () => {
    const { store } = await catalog.create(identity)

    expect(await store.attachEventMedia(randomUUID(), 'manual/x/one.jpg')).toBe(false)
  })

  it('removes a medium nothing names, and says nothing of one that is not there', async () => {
    const { store } = await catalog.create(identity)
    await store.putMedia('manual/e/one.jpg', new TextEncoder().encode('x'))

    await store.removeMedia('manual/e/one.jpg')
    await store.removeMedia('manual/e/none.jpg')
    expect(await store.hasMedia('manual/e/one.jpg')).toBe(false)
  })

  it('refuses to remove a medium outside the replay', async () => {
    const { store } = await catalog.create(identity)

    await expect(store.removeMedia('../other/one.jpg')).rejects.toThrow(/outside the replay/)
  })

  it('survives the derivation writing its crossings again', async () => {
    const { store } = await catalog.create(identity)
    const added = await store.addManualEvent(WRITTEN)

    await store.putDataset('events', [], aReport({ singleStep: 0, setAside: {} }))
    expect(await store.getDataset('events')).toEqual([added])
  })
})

/** Ages a replay, since two creations in one test share a millisecond. */
async function olderBy(pool: Pool, id: string, at: string): Promise<void> {
  await pool.query('update replay set created_at = $2 where id = $1', [id, at])
}
