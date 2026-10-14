import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { ReplayEvent, ReplayManifest } from '@smmarchives/shared'

import {
  aDataset,
  aManifest,
  anApi,
  appOn,
  cleanRoots,
  closeDatabase,
  writeReplay,
  type Problem,
} from './support/replay.ts'
import { withServer } from './support/server.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

/** Around Carcassonne, well inside the territory. */
const EXTENT = { minLon: 2.2, minLat: 43.1, maxLon: 2.5, maxLat: 43.3 }

const REPORT = {
  title: 'Route coupée',
  description: 'La D118 est submergée au pont.\nDéviation par Limoux.',
  producerKind: 'Agent SMMAR',
  from: '2019-10-22T08:00:00+02:00',
  to: '2019-10-22T12:30:00Z',
  position: { type: 'Point', coordinates: [2.35, 43.21] },
}

async function aReplay(overrides: Partial<ReplayManifest> = {}) {
  const api = await anApi()
  const manifest = aManifest({ extent: EXTENT, datasets: { events: aDataset(0) }, ...overrides })
  await writeReplay(api, manifest, {
    datasets: manifest.datasets.events === undefined ? {} : { events: [] },
  })
  return { api, id: manifest.id }
}

function report(base: string, id: string, payload: unknown): Promise<Response> {
  return fetch(`${base}/replays/${id}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function refusalsOf(response: Response): Promise<{ path: string; message: string }[]> {
  expect(response.status).toBe(400)
  return ((await response.json()) as { refusals: { path: string; message: string }[] }).refusals
}

describe('reporting an event', () => {
  it('stores it as a manual field report, on the single clock', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await report(base, id, REPORT)
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({
        origin: 'manual',
        category: 'field-report',
        title: 'Route coupée',
        producerKind: 'Agent SMMAR',
        from: '2019-10-22T06:00:00.000Z',
        to: '2019-10-22T12:30:00.000Z',
        position: REPORT.position,
        media: [],
      })
    })
  })

  it('serves it with the events, under a version the list held before no longer matches', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const before = await fetch(`${base}/replays/${id}/events`)
      const created = (await (await report(base, id, REPORT)).json()) as ReplayEvent

      const after = await fetch(`${base}/replays/${id}/events`, {
        headers: { 'if-none-match': before.headers.get('etag') ?? '' },
      })
      expect(after.status).toBe(200)
      expect(((await after.json()) as ReplayEvent[]).map((event) => event.id)).toEqual([created.id])
    })
  })

  it('takes an event with neither end, description nor position', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await report(base, id, {
        title: 'Appel du maire',
        producerKind: 'Commune',
        from: '2019-10-22T10:00:00Z',
      })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ to: null, description: null, position: null })
    })
  })

  it('takes an area lying within the extent', async () => {
    const { api, id } = await aReplay()
    const area = {
      type: 'Polygon',
      coordinates: [
        [
          [2.3, 43.2],
          [2.4, 43.2],
          [2.4, 43.25],
          [2.3, 43.2],
        ],
      ],
    }

    await withServer(appOn(api), async (base) => {
      expect((await report(base, id, { ...REPORT, position: area })).status).toBe(201)
    })
  })
})

describe('refusing an event', () => {
  it('names the fields it refused, never the values sent', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await report(base, id, {
        ...REPORT,
        title: 'Route\u0007 coupée',
        producerKind: '   ',
        from: 'hier soir',
      })
      const body = JSON.stringify(await response.clone().json())
      expect((await refusalsOf(response)).map((one) => one.path).sort()).toEqual([
        'from',
        'producerKind',
        'title',
      ])
      expect(body).not.toContain('hier soir')
    })
  })

  it('refuses a field the store settles', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const refusals = await refusalsOf(await report(base, id, { ...REPORT, origin: 'automatic' }))
      expect(refusals).toEqual([{ path: 'origin', message: 'is not a field of this request' }])
    })
  })

  it('refuses an instant outside the replay period', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const refusals = await refusalsOf(
        await report(base, id, {
          ...REPORT,
          from: '2019-10-21T23:59:59Z',
          to: '2019-10-23T00:00:01Z',
        }),
      )
      expect(refusals).toEqual([
        { path: 'from', message: 'lies outside the replay period' },
        { path: 'to', message: 'lies outside the replay period' },
      ])
    })
  })

  it('refuses an end before its start', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const refusals = await refusalsOf(
        await report(base, id, {
          ...REPORT,
          from: '2019-10-22T12:00:00Z',
          to: '2019-10-22T11:00:00Z',
        }),
      )
      expect(refusals).toEqual([{ path: 'to', message: 'ends before it starts' }])
    })
  })

  it('refuses an area reaching outside the extent', async () => {
    const { api, id } = await aReplay()
    const area = {
      type: 'Polygon',
      coordinates: [
        [
          [2.3, 43.2],
          [2.6, 43.2],
          [2.4, 43.25],
          [2.3, 43.2],
        ],
      ],
    }

    await withServer(appOn(api), async (base) => {
      const refusals = await refusalsOf(await report(base, id, { ...REPORT, position: area }))
      expect(refusals).toEqual([{ path: 'position', message: 'lies outside the replay extent' }])
    })
  })

  it('judges a replay without an extent against the territory', async () => {
    const { api, id } = await aReplay({ extent: null })

    await withServer(appOn(api), async (base) => {
      const inside = await report(base, id, REPORT)
      expect(inside.status).toBe(201)
      const refusals = await refusalsOf(
        await report(base, id, {
          ...REPORT,
          position: { type: 'Point', coordinates: [2.35, 48.85] },
        }),
      )
      expect(refusals).toEqual([{ path: 'position', message: 'lies outside the replay extent' }])
    })
  })

  it('answers 404 for a replay nobody built', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await report(base, crypto.randomUUID(), REPORT)
      expect(response.status).toBe(404)
    })
  })

  it('answers 409 while the replay is being built', async () => {
    const { api, id } = await aReplay({ state: 'running' })

    await withServer(appOn(api), async (base) => {
      const response = await report(base, id, REPORT)
      expect(response.status).toBe(409)
      expect(((await response.json()) as Problem).detail).toBe(`replay ${id} is being built`)
    })
  })

  it('answers 409 for a replay that holds no events data set', async () => {
    const { api, id } = await aReplay({ datasets: {} })

    await withServer(appOn(api), async (base) => {
      const response = await report(base, id, REPORT)
      expect(response.status).toBe(409)
      expect(((await response.json()) as Problem).detail).toBe(
        `replay ${id} holds no events data set`,
      )
    })
  })
})

describe('refusing an area', () => {
  it('refuses an area that encloses nothing, rather than storing one nobody can see', async () => {
    const { api, id } = await aReplay()
    const flat = {
      type: 'Polygon',
      coordinates: [
        [
          [2.3, 43.2],
          [2.35, 43.2],
          [2.4, 43.2],
          [2.3, 43.2],
        ],
      ],
    }

    await withServer(appOn(api), async (base) => {
      const refusals = await refusalsOf(await report(base, id, { ...REPORT, position: flat }))
      expect(refusals).toEqual([{ path: 'position.coordinates.0', message: 'encloses nothing' }])
    })
  })
})
