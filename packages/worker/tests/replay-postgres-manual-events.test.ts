import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { ReplayEvent, ReplayIdentity } from '@smmarchives/shared'

import type { ManualEvent, ReplayStore } from '../src/replay/store.ts'
import { openPostgresCatalog } from '../src/replay/postgres/catalog.ts'
import { openPostgresStore } from '../src/replay/postgres/store.ts'
import { closeDatabase, freshDatabase } from './support/database.ts'
import { aReport, aStoredReplay, bytesOf, cleanMedia, frozenBytes } from './support/replay-store.ts'

afterEach(cleanMedia)
afterAll(closeDatabase)

const identity: Omit<ReplayIdentity, 'id'> = {
  label: "Crue de l'Aude, octobre 2019",
  extent: { minLon: 2.0, minLat: 42.7, maxLon: 3.2, maxLat: 43.6 },
  period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
}

const CROSSING: ReplayEvent = {
  id: 'crossing:84:level:11:2019-10-22T06:00:00.000Z',
  origin: 'automatic',
  category: 'threshold-crossing',
  title: 'Trèbes — Vigilance',
  description: null,
  producerKind: null,
  severity: 1,
  color: '#ffcc00',
  from: '2019-10-22T06:00:00.000Z',
  to: null,
  position: { type: 'Point', coordinates: [2.4433, 43.21] },
  sourceId: 84,
  media: [],
  crossing: null,
}

const REPORTED: ManualEvent = {
  title: 'RD 118 coupée',
  description: 'La route est sous l’eau au droit du pont.',
  producerKind: 'Commune',
  from: '2019-10-22T07:30:00.000Z',
  to: '2019-10-22T11:00:00.000Z',
  position: {
    type: 'Polygon',
    coordinates: [
      [
        [2.35, 43.21],
        [2.36, 43.21],
        [2.36, 43.22],
        [2.35, 43.21],
      ],
    ],
  },
  media: ['events/rd118-1.jpg', 'events/rd118-2.jpg'],
}

const AMENDED: ManualEvent = {
  title: 'RD 118 rouverte',
  description: null,
  producerKind: 'Agent SMMAR',
  from: '2019-10-22T08:00:00.000Z',
  to: null,
  position: { type: 'Point', coordinates: [2.355, 43.215] },
  media: ['events/rd118-2.jpg'],
}

async function aReplayWithCrossings(): Promise<ReplayStore> {
  const { store } = await aStoredReplay(identity)
  await store.putDataset('events', [CROSSING], aReport())
  return store
}

async function versionOf(store: ReplayStore): Promise<string | undefined> {
  return (await store.openDataset('events'))?.version
}

describe('an event an agent reports', () => {
  it('reads back as it was written, under an identifier the database minted', async () => {
    const store = await aReplayWithCrossings()

    const added = await store.addManualEvent(REPORTED)

    expect(added).toEqual({
      ...REPORTED,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      origin: 'manual',
      category: 'field-report',
      severity: null,
      color: null,
      sourceId: null,
      crossing: null,
    })
  })

  it('joins the crossings in the events data set', async () => {
    const store = await aReplayWithCrossings()

    const added = await store.addManualEvent(REPORTED)

    expect(await store.getDataset('events')).toEqual([CROSSING, added])
  })

  it('moves the version of the events data set', async () => {
    const store = await aReplayWithCrossings()
    const before = await versionOf(store)

    await store.addManualEvent(REPORTED)

    expect(await versionOf(store)).not.toBe(before)
  })

  it('leaves the count of crossings alone', async () => {
    const store = await aReplayWithCrossings()

    await store.addManualEvent(REPORTED)

    expect((await store.getManifest())?.events?.crossings).toBe(1)
  })
})

describe('reading one event an agent reported', () => {
  it('answers it as the events data set holds it', async () => {
    const store = await aReplayWithCrossings()
    const added = await store.addManualEvent(REPORTED)

    expect(await store.getManualEvent(added.id)).toEqual(added)
  })

  it('answers undefined for a crossing', async () => {
    const store = await aReplayWithCrossings()

    expect(await store.getManualEvent(CROSSING.id)).toBeUndefined()
  })

  it('answers undefined for an event nobody reported', async () => {
    const store = await aReplayWithCrossings()

    expect(await store.getManualEvent(crypto.randomUUID())).toBeUndefined()
  })
})

describe('the events served while an agent writes', () => {
  /**
   * A list served under a version newer than its rows would be taken as
   * current at every revalidation, whatever was written since.
   */
  it('never carry a version newer than the rows they hold', async () => {
    const pool = await freshDatabase('test_manual_events_served')
    const { id, store } = await openPostgresCatalog({ pool, mediaRoot: tmpdir() }).create(identity)
    await store.putDataset('events', [CROSSING], aReport())

    // A connection that lets an agent's write land right after the version is read.
    let written = false
    const racing = new Proxy(pool, {
      get(target, key) {
        if (key !== 'query') return Reflect.get(target, key, target) as unknown
        return async (...args: Parameters<typeof pool.query>) => {
          const result = await (target.query as (...a: unknown[]) => Promise<unknown>)(...args)
          if (!written && String(args[0]).includes('select updated_at from replay_dataset')) {
            written = true
            await store.addManualEvent(REPORTED)
          }
          return result
        }
      },
    })
    const reading = openPostgresStore({ pool: racing, replayId: id, mediaRoot: tmpdir() })

    const served = await reading.openDataset('events')
    const latest = await store.openDataset('events')
    const rows =
      served === undefined ? [] : (JSON.parse(String(await bytesOf(served))) as unknown[])

    // The write is in what was served, under a version that still says to fetch again.
    expect(rows).toHaveLength(2)
    expect(served?.version).not.toBe(latest?.version)
  })
})

describe('amending an event an agent reported', () => {
  it('rewrites what the agent wrote and keeps what the store settled', async () => {
    const store = await aReplayWithCrossings()
    const added = await store.addManualEvent(REPORTED)

    const change = await store.updateManualEvent(added.id, AMENDED)

    expect(change).toEqual({ previous: added, current: { ...added, ...AMENDED } })
    expect(await store.getDataset('events')).toEqual([CROSSING, change?.current])
  })

  it('moves the version of the events data set', async () => {
    const store = await aReplayWithCrossings()
    const added = await store.addManualEvent(REPORTED)
    const before = await versionOf(store)

    await store.updateManualEvent(added.id, AMENDED)

    expect(await versionOf(store)).not.toBe(before)
  })

  it('leaves a crossing as the measures made it', async () => {
    const store = await aReplayWithCrossings()

    expect(await store.updateManualEvent(CROSSING.id, AMENDED)).toBeUndefined()
    expect(await store.getDataset('events')).toEqual([CROSSING])
  })

  it('answers undefined for an event nobody reported', async () => {
    const store = await aReplayWithCrossings()

    expect(await store.updateManualEvent(crypto.randomUUID(), AMENDED)).toBeUndefined()
  })
})

describe('removing an event an agent reported', () => {
  it('takes it out of the events data set and answers what it was', async () => {
    const store = await aReplayWithCrossings()
    const added = await store.addManualEvent(REPORTED)

    expect(await store.removeManualEvent(added.id)).toEqual(added)
    expect(await store.getDataset('events')).toEqual([CROSSING])
  })

  it('moves the version of the events data set', async () => {
    const store = await aReplayWithCrossings()
    const added = await store.addManualEvent(REPORTED)
    const before = await versionOf(store)

    await store.removeManualEvent(added.id)

    expect(await versionOf(store)).not.toBe(before)
  })

  it('leaves a crossing where it is', async () => {
    const store = await aReplayWithCrossings()

    expect(await store.removeManualEvent(CROSSING.id)).toBeUndefined()
    expect(await store.getDataset('events')).toEqual([CROSSING])
  })

  it('answers undefined for an event nobody reported', async () => {
    const store = await aReplayWithCrossings()

    expect(await store.removeManualEvent(crypto.randomUUID())).toBeUndefined()
  })
})

describe('removing a medium', () => {
  it('takes it off the volume', async () => {
    const { id, store, mediaRoot } = await aStoredReplay(identity)
    await store.putMedia('field-reports/a/1.jpg', Uint8Array.from([0xff, 0xd8, 0xff]))

    await store.removeMedia('field-reports/a/1.jpg')

    expect(await frozenBytes(store, 'field-reports/a/1.jpg')).toBeUndefined()
    expect(existsSync(join(mediaRoot, id, 'field-reports/a/1.jpg'))).toBe(false)
  })

  it('says nothing of one already gone', async () => {
    const { store } = await aStoredReplay(identity)

    await expect(store.removeMedia('field-reports/a/1.jpg')).resolves.toBeUndefined()
  })

  it('refuses a medium that would lie outside the replay', async () => {
    const { store } = await aStoredReplay(identity)

    await expect(store.removeMedia('../other/1.jpg')).rejects.toThrow(/outside the replay/)
  })
})
