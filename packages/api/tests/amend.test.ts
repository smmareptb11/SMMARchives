import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { ReplayEvent, ReplayManifest } from '@smmarchives/shared'

import { openPostgresSessionStore } from '@smmarchives/worker/session/postgres.ts'

import { createApp } from '../src/app.ts'
import {
  aCatalog,
  aDataset,
  aManifest,
  anApi,
  appOn,
  aStore,
  buildingOnceOpened,
  cleanRoots,
  closeDatabase,
  neverLaunches,
  writeReplay,
  type Api,
} from './support/replay.ts'
import { withServer } from './support/server.ts'
import { anAuth, asAdmin } from './support/session.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

const CROSSING_ID = 'crossing:84:level:11:2019-10-22T06:00:00.000Z'

const CROSSING: ReplayEvent = {
  id: CROSSING_ID,
  origin: 'automatic',
  category: 'threshold-crossing',
  title: 'Trèbes — Vigilance',
  description: null,
  producerKind: null,
  link: null,
  severity: 1,
  color: '#ffcc00',
  from: '2019-10-22T06:00:00.000Z',
  to: null,
  position: { type: 'Point', coordinates: [2.4433, 43.21] },
  sourceId: 84,
  media: [],
  crossing: null,
}

const REPORT = {
  title: 'Route coupée',
  producerKind: 'Agent SMMAR',
  from: '2019-10-22T08:00:00Z',
}

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2])

async function aReplay(overrides: Partial<ReplayManifest> = {}) {
  const api = await anApi()
  const manifest = aManifest({ datasets: { events: aDataset(1) }, ...overrides })
  await writeReplay(api, manifest, { datasets: { events: [CROSSING] } })
  return { api, id: manifest.id }
}

function aForm(event: unknown, ...photos: Uint8Array[]): FormData {
  const form = new FormData()
  form.append('event', JSON.stringify(event))
  for (const photo of photos) form.append('photo', new Blob([photo]), 'photo')
  return form
}

/** An event with two photos, reported the way a client reports one. */
async function reported(base: string, id: string): Promise<ReplayEvent> {
  const response = await asAdmin(base, `/replays/${id}/events`, {
    method: 'POST',
    body: aForm(REPORT, JPEG, PNG),
  })
  return (await response.json()) as ReplayEvent
}

function amend(base: string, id: string, eventId: string, body: unknown): Promise<Response> {
  return asAdmin(base, `/replays/${id}/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    ...(body instanceof FormData
      ? { body }
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

function remove(base: string, id: string, eventId: string): Promise<Response> {
  return asAdmin(base, `/replays/${id}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  })
}

async function eventsOf(base: string, id: string): Promise<ReplayEvent[]> {
  return (await (await fetch(`${base}/replays/${id}/events`)).json()) as ReplayEvent[]
}

function onVolume(api: Api, id: string, path: string): boolean {
  return existsSync(join(api.mediaRoot, id, path))
}

describe('amending an event an agent reported', () => {
  it('replaces what the agent wrote and keeps its identifier', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)
      const before = (await fetch(`${base}/replays/${id}/events`)).headers.get('etag')

      const response = await amend(base, id, added.id, {
        title: 'Route rouverte',
        producerKind: 'Commune',
        from: '2019-10-22T10:00:00+02:00',
        description: 'Rouverte à la circulation.',
        media: added.media,
      })
      expect(response.status).toBe(200)
      const amended = (await response.json()) as ReplayEvent
      expect(amended).toMatchObject({
        id: added.id,
        origin: 'manual',
        title: 'Route rouverte',
        producerKind: 'Commune',
        from: '2019-10-22T08:00:00.000Z',
        description: 'Rouverte à la circulation.',
        media: added.media,
      })
      expect((await eventsOf(base, id)).find((one) => one.id === added.id)).toEqual(amended)
      expect((await fetch(`${base}/replays/${id}/events`)).headers.get('etag')).not.toBe(before)
    })
  })

  it('forgets a field the amendment leaves out, rather than keeping the old value', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)
      await amend(base, id, added.id, {
        ...REPORT,
        description: 'Pont submergé.',
        link: 'https://actualites.test/d118-submergee',
        media: [],
      })

      const response = await amend(base, id, added.id, { ...REPORT, media: [] })
      expect(await response.json()).toMatchObject({ description: null, link: null })
    })
  })

  it('takes off the volume the photos it no longer keeps', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)
      const [first, second] = added.media as [string, string]

      const response = await amend(base, id, added.id, { ...REPORT, media: [second] })
      expect(((await response.json()) as ReplayEvent).media).toEqual([second])
      expect(onVolume(api, id, first)).toBe(false)
      expect((await fetch(`${base}/replays/${id}/media/${first}`)).status).toBe(404)
      expect((await fetch(`${base}/replays/${id}/media/${second}`)).status).toBe(200)
    })
  })

  it('puts new photos after the ones it keeps, in the order the agent left those', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)
      const [first, second] = added.media as [string, string]

      const response = await amend(
        base,
        id,
        added.id,
        aForm({ ...REPORT, media: [second, first] }, JPEG),
      )
      const { media } = (await response.json()) as ReplayEvent
      expect(media).toEqual([
        second,
        first,
        expect.stringMatching(/^field-reports\/[0-9a-f-]{36}\/1\.jpg$/),
      ])
      // A folder of its own: the new photo never takes the address of an old one.
      expect(media[2]?.split('/')[1]).not.toBe(first.split('/')[1])
    })
  })
})

describe('refusing an amendment', () => {
  it('takes its photos off the volume when the replay starts being built while they arrive', async () => {
    const { api, id } = await aReplay()
    let added: ReplayEvent | undefined
    await withServer(appOn(api), async (base) => {
      added = await reported(base, id)
    })

    await withServer(appOn({ ...api, catalog: buildingOnceOpened(api.catalog) }), async (base) => {
      const response = await amend(
        base,
        id,
        added!.id,
        aForm({ ...REPORT, media: added!.media }, JPEG),
      )
      expect(response.status).toBe(409)
      expect(readdirSync(join(api.mediaRoot, id, 'field-reports'))).toEqual([
        added!.media[0]!.split('/')[1],
      ])
    })
  })

  /**
   * Another amendment lands while this one's photos arrive: this one was read
   * against the event as it was, and keeps a photo the other took away.
   */
  it('refuses to keep a photo another amendment removed meanwhile', async () => {
    const { api, id } = await aReplay()
    let stale: ReplayEvent | undefined
    const racing = aCatalog({
      ...api.catalog,
      open: async (replayId) => {
        const store = await api.catalog.open(replayId)
        if (store === undefined) return undefined
        return {
          ...store,
          getManualEvent: async (eventId) => {
            const read = stale ?? (await store.getManualEvent(eventId))
            stale = undefined
            return read
          },
        }
      },
    })
    const app = createApp({
      catalog: racing,
      auth: anAuth(openPostgresSessionStore(api.pool)),
      launch: neverLaunches,
    })

    await withServer(app, async (base) => {
      const added = await reported(base, id)
      const [first, second] = added.media as [string, string]
      await amend(base, id, added.id, { ...REPORT, media: [second] })
      stale = added

      const response = await amend(base, id, added.id, aForm({ ...REPORT, media: [first] }, JPEG))
      expect(response.status).toBe(409)
      const [event] = (await eventsOf(base, id)).filter((one) => one.id === added.id)
      expect(event?.media).toEqual([second])
      // The photo it sent is not left behind, in a folder nothing points at.
      expect(readdirSync(join(api.mediaRoot, id, 'field-reports'))).toEqual([second.split('/')[1]])
    })
  })

  it('refuses to keep a photo the event does not hold, and changes nothing', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)
      const other = await reported(base, id)

      const response = await amend(base, id, added.id, { ...REPORT, media: [other.media[0]] })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { refusals: unknown }).refusals).toEqual([
        { path: 'media', message: 'names a photo the event does not hold' },
      ])
      expect((await eventsOf(base, id)).find((one) => one.id === added.id)).toEqual(added)
    })
  })

  it('refuses an amendment that does not say which photos it keeps', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)

      const response = await amend(base, id, added.id, REPORT)
      expect(response.status).toBe(400)
      expect(onVolume(api, id, added.media[0] as string)).toBe(true)
    })
  })

  it('judges it against the replay as a report is', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)

      const response = await amend(base, id, added.id, {
        ...REPORT,
        from: '2019-10-24T00:00:00Z',
        media: [],
      })
      expect(response.status).toBe(400)
    })
  })

  it('answers 404 for a crossing, without repeating the identifier asked for', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await amend(base, id, CROSSING_ID, { ...REPORT, media: [] })
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('crossing:84')
      expect(await eventsOf(base, id)).toEqual([CROSSING])
    })
  })

  it('answers 404 for an event nobody reported', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await amend(base, id, crypto.randomUUID(), { ...REPORT, media: [] })
      expect(response.status).toBe(404)
    })
  })

  it('answers 409 while the replay is being built', async () => {
    const { api, id } = await aReplay({ state: 'running' })

    await withServer(appOn(api), async (base) => {
      const response = await amend(base, id, crypto.randomUUID(), { ...REPORT, media: [] })
      expect(response.status).toBe(409)
    })
  })
})

describe('removing an event an agent reported', () => {
  it('takes it out of the events, and its photos off the volume', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)

      const response = await remove(base, id, added.id)
      expect(response.status).toBe(204)
      expect(await eventsOf(base, id)).toEqual([CROSSING])
      for (const path of added.media) expect(onVolume(api, id, path)).toBe(false)
    })
  })

  it('answers 404 the second time', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const added = await reported(base, id)

      await remove(base, id, added.id)
      expect((await remove(base, id, added.id)).status).toBe(404)
    })
  })

  it('answers 404 for a crossing, and leaves it', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      expect((await remove(base, id, CROSSING_ID)).status).toBe(404)
      expect(await eventsOf(base, id)).toEqual([CROSSING])
    })
  })

  it('answers 409 while the replay is being built', async () => {
    const { api, id } = await aReplay({ state: 'running' })

    await withServer(appOn(api), async (base) => {
      expect((await remove(base, id, crypto.randomUUID())).status).toBe(409)
    })
  })
})

describe('a photo that cannot be removed', () => {
  it('is logged, and the removal it follows still stands', async () => {
    const manifest = aManifest({ datasets: { events: aDataset(1) } })
    const event: ReplayEvent = {
      ...CROSSING,
      id: crypto.randomUUID(),
      origin: 'manual',
      category: 'field-report',
      producerKind: 'Commune',
      media: ['field-reports/a/1.jpg'],
    }
    const store = aStore({
      getManifest: async () => manifest,
      removeManualEvent: async () => event,
      removeMedia: async () => {
        throw new Error('EACCES: permission denied')
      },
    })
    const said: string[] = []
    const served = createApp({
      catalog: aCatalog({ open: async () => store }),
      auth: anAuth(),
      launch: neverLaunches,
      log: (message) => said.push(message),
    })

    await withServer(served, async (base) => {
      const response = await remove(base, manifest.id, event.id)
      expect(response.status).toBe(204)
    })
    expect(said).toEqual([expect.stringContaining('field-reports/a/1.jpg')])
    expect(said[0]).toContain('EACCES')
  })
})
