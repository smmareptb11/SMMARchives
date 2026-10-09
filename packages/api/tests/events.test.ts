import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { ReplayEvent } from '@smmarchives/shared'

import { createApp } from '../src/app.ts'
import {
  aCatalog,
  aManifest,
  anApi,
  appOn,
  aStore,
  neverLaunches,
  cleanRoots,
  closeDatabase,
  writeReplay,
  type Problem,
} from './support/replay.ts'
import { withServer } from './support/server.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

/** The period `aManifest` gives a replay. */
const WITHIN = '2019-10-22T09:00:00.000Z'

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])

async function aReplay(options: { imageLimit?: number; state?: 'running' } = {}) {
  const api = await anApi()
  const manifest = aManifest(options.state === undefined ? {} : { state: options.state })
  await writeReplay(api, manifest)
  return { id: manifest.id, app: appOn(api, { imageLimit: options.imageLimit }) }
}

function postEvent(base: string, id: string, payload: unknown): Promise<Response> {
  return fetch(`${base}/replays/${id}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function putImage(base: string, id: string, eventId: string, body: Uint8Array): Promise<Response> {
  return fetch(`${base}/replays/${id}/events/${eventId}/image`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  })
}

async function added(base: string, id: string): Promise<ReplayEvent> {
  return (await (
    await postEvent(base, id, { title: 'D118 coupée', from: WITHIN })
  ).json()) as ReplayEvent
}

describe('adding an event to a replay', () => {
  it('answers the event as a reader of the replay will read it', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await postEvent(base, id, {
        title: '  D118 coupée à Couffoulens ',
        description: 'Route inondée sur 200 m.',
        from: '2019-10-22T11:00:00+02:00',
        to: '2019-10-22T19:00:00Z',
        position: { lon: 2.3167, lat: 43.1583 },
        provenance: 'municipality',
      })

      expect(response.status).toBe(201)
      const event = (await response.json()) as ReplayEvent
      expect(event).toMatchObject({
        origin: 'manual',
        category: 'report',
        title: 'D118 coupée à Couffoulens',
        description: 'Route inondée sur 200 m.',
        from: WITHIN,
        to: '2019-10-22T19:00:00.000Z',
        position: { lon: 2.3167, lat: 43.1583 },
        provenance: 'municipality',
        media: [],
      })

      const events = (await (await fetch(`${base}/replays/${id}/events`)).json()) as ReplayEvent[]
      expect(events).toEqual([event])
    })
  })

  it('needs no more than a title and a start', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await postEvent(base, id, { title: 'Témoignage', from: WITHIN })

      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({
        description: null,
        to: null,
        position: null,
        provenance: null,
      })
    })
  })

  it('reads an empty description as none', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await postEvent(base, id, { title: 'T', from: WITHIN, description: '  ' })
      expect(((await response.json()) as ReplayEvent).description).toBeNull()
    })
  })

  it.each([
    ['no title', { from: WITHIN }, 'title'],
    ['an empty title', { title: '   ', from: WITHIN }, 'title'],
    ['no start', { title: 'T' }, 'from'],
    ['a start that is no instant', { title: 'T', from: 'demain' }, 'from'],
    // Read in the server's own zone otherwise, two hours apart from host to host.
    ['a start without its zone', { title: 'T', from: '2019-10-22T09:00' }, 'from'],
    ['an end before the start', { title: 'T', from: WITHIN, to: '2019-10-22T08:00:00Z' }, 'to'],
    [
      'a provenance nobody listed',
      { title: 'T', from: WITHIN, provenance: 'prefecture' },
      'provenance',
    ],
    [
      'a position off the globe',
      { title: 'T', from: WITHIN, position: { lon: 200, lat: 0 } },
      'position.lon',
    ],
    ['a field the store settles', { title: 'T', from: WITHIN, origin: 'automatic' }, 'origin'],
  ])('refuses %s, naming the field', async (_, payload, path) => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await postEvent(base, id, payload)

      expect(response.status).toBe(400)
      const problem = (await response.json()) as Problem & { refusals: { path: string }[] }
      expect(problem.refusals.map((one) => one.path)).toContain(path)
    })
  })

  it('refuses a fact outside the period of the replay', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await postEvent(base, id, {
        title: 'T',
        from: WITHIN,
        to: '2019-10-24T00:00:00Z',
      })

      expect(response.status).toBe(400)
      expect(((await response.json()) as { refusals: unknown }).refusals).toEqual([
        { path: 'to', message: 'must fall within the period of the replay' },
      ])
    })
  })

  it('never repeats what it was sent', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await postEvent(base, id, { title: '<script>', from: 'secret-date' })
      expect(await response.text()).not.toMatch(/script|secret-date/)
    })
  })

  it('refuses a place outside the extent of the replay, naming the field', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await postEvent(base, id, {
        title: 'T',
        from: WITHIN,
        position: { lon: 150, lat: -30 },
      })

      expect(response.status).toBe(400)
      expect(((await response.json()) as { refusals: unknown }).refusals).toEqual([
        { path: 'position', message: 'must fall within the extent of the replay' },
      ])
    })
  })

  it('answers 404 for a replay nobody built', async () => {
    const { app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await postEvent(base, crypto.randomUUID(), { title: 'T', from: WITHIN })
      expect(response.status).toBe(404)
    })
  })
})

describe('attaching an image to an event', () => {
  it('stores it under a name of its own, served like any frozen medium', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const event = await added(base, id)
      const response = await putImage(base, id, event.id, JPEG)

      expect(response.status).toBe(201)
      const [path] = ((await response.json()) as ReplayEvent).media
      expect(path).toMatch(new RegExp(`^manual/${event.id}/[0-9a-f-]{36}\\.jpg$`))

      const served = await fetch(`${base}/replays/${id}/media/${path ?? ''}`)
      expect(served.headers.get('content-type')).toContain('image/jpeg')
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG)

      const events = (await (await fetch(`${base}/replays/${id}/events`)).json()) as ReplayEvent[]
      expect(events[0]?.media).toEqual([path])
    })
  })

  it('refuses what is not a JPEG, a PNG or a WebP, whatever it is called', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const event = await added(base, id)
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')

      const response = await putImage(base, id, event.id, svg)
      expect(response.status).toBe(415)
    })
  })

  it('refuses an image heavier than the limit, and says the limit', async () => {
    const { id, app } = await aReplay({ imageLimit: 16 })

    await withServer(app, async (base) => {
      const event = await added(base, id)

      const response = await putImage(base, id, event.id, new Uint8Array(64).fill(0xff))
      expect(response.status).toBe(413)
      expect(((await response.json()) as Problem).detail).toBe('an image weighs at most 16 bytes')
    })
  })

  /** Checked before the bytes are read: a wrong address costs nothing to answer. */
  it('answers for an event it does not hold before reading what weighs too much', async () => {
    const { id, app } = await aReplay({ imageLimit: 16 })

    await withServer(app, async (base) => {
      const response = await putImage(base, id, crypto.randomUUID(), new Uint8Array(64))
      expect(response.status).toBe(404)
    })
  })

  it('refuses a second image, which would replace an address served for good', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const event = await added(base, id)
      await putImage(base, id, event.id, JPEG)

      const response = await putImage(base, id, event.id, JPEG)
      expect(response.status).toBe(409)
    })
  })

  it('refuses an image on a crossing the replay derived', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)
    await api.pool.query(
      `insert into event (replay_id, id, origin, category, title, starts_at)
       values ($1, 'crossing', 'automatic', 'threshold-crossing', 'Vigilance', $2)`,
      [manifest.id, WITHIN],
    )

    await withServer(appOn(api), async (base) => {
      const response = await putImage(base, manifest.id, 'crossing', JPEG)
      expect(response.status).toBe(409)
    })
  })

  it('answers 404 for an event the replay does not hold, without naming it', async () => {
    const { id, app } = await aReplay()

    await withServer(app, async (base) => {
      const response = await putImage(base, id, '..%2F..%2Fescape', JPEG)

      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('escape')
    })
  })
})

/** An event an agent wrote, as a store answers it. */
const WRITTEN_EVENT = {
  id: 'e1',
  origin: 'manual' as const,
  category: 'report' as const,
  title: 'T',
  description: null,
  provenance: null,
  severity: null,
  color: null,
  from: WITHIN,
  to: null,
  position: null,
  sourceId: null,
  media: [],
  crossing: null,
}

describe("an image that did not become the event's own", () => {
  /** Nothing names those bytes, and they would pile up on the volume. */
  it('is taken off the volume', async () => {
    const removed: string[] = []
    const store = aStore({
      getEvent: async () => WRITTEN_EVENT,
      attachEventMedia: async () => false,
      removeMedia: async (path) => {
        removed.push(path)
      },
    })
    const app = createApp({ catalog: aCatalog({ open: async () => store }), launch: neverLaunches })

    await withServer(app, async (base) => {
      const response = await putImage(base, crypto.randomUUID(), 'e1', JPEG)

      expect(response.status).toBe(409)
      expect(removed).toEqual([expect.stringMatching(/^manual\/e1\/[0-9a-f-]{36}\.jpg$/)])
    })
  })

  /** The error worth raising is the one that left the bytes unnamed. */
  it('keeps the error that left it unnamed when it cannot be removed either', async () => {
    const said: string[] = []
    const store = aStore({
      getEvent: async () => WRITTEN_EVENT,
      attachEventMedia: async () => {
        throw new Error('the database went away')
      },
      removeMedia: async () => {
        throw new Error('the volume refused')
      },
    })
    const app = createApp({
      catalog: aCatalog({ open: async () => store }),
      launch: neverLaunches,
      log: (message) => said.push(message),
    })

    await withServer(app, async (base) => {
      const response = await putImage(base, crypto.randomUUID(), 'e1', JPEG)

      expect(response.status).toBe(500)
      expect(said.join('\n')).toContain('the database went away')
      expect(said.join('\n')).toContain('the volume refused')
    })
  })
})

describe('what the form needs to know before it sends anything', () => {
  it('is the heaviest image an event takes', async () => {
    const { app } = await aReplay({ imageLimit: 2048 })

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/limits`)
      expect(await response.json()).toEqual({ manualImageBytes: 2048 })
    })
  })
})
