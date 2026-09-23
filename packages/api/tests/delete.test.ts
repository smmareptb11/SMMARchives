import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { ReplayManifest } from '@smmarchives/shared'

import { createApp } from '../src/app.ts'
import {
  aCatalog,
  aDataset,
  aManifest,
  anApi,
  appOn,
  cleanRoots,
  closeDatabase,
  corruptManifest,
  neverLaunches,
  post,
  writeReplay,
  type Problem,
} from './support/replay.ts'
import { withServer } from './support/server.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

function remove(base: string, id: string) {
  return fetch(`${base}/replays/${id}`, { method: 'DELETE' })
}

const PERIOD = { from: '2019-10-22T00:00:00Z', to: '2019-10-23T00:00:00Z' }

describe('deleting a replay', () => {
  it('removes everything it held, rows and bytes alike', async () => {
    const api = await anApi()
    const manifest = aManifest({ datasets: { measures: aDataset('measures', 1) } })
    await writeReplay(api, manifest, {
      datasets: {
        measures: [{ sourceId: 1, quantity: 'level', at: '2019-10-22T06:00:00.000Z', value: 1 }],
      },
      media: { 'webcams/215/1.jpg': 'x', 'radar/20034/pluvio5mn/1.png': 'y' },
    })

    await withServer(appOn(api), async (base) => {
      expect((await remove(base, manifest.id)).status).toBe(204)
      expect((await fetch(`${base}/replays/${manifest.id}`)).status).toBe(404)
    })
    // Not a trace on either side: the database cascades, the volume is removed.
    expect(existsSync(join(api.mediaRoot, manifest.id))).toBe(false)
    expect(await api.catalog.list()).toEqual([])
  })

  it('takes it out of the listing', async () => {
    const api = await anApi()
    const going = aManifest()
    const staying = aManifest()
    await writeReplay(api, going)
    await writeReplay(api, staying)

    await withServer(appOn(api), async (base) => {
      expect((await remove(base, going.id)).status).toBe(204)

      const listed = (await (await fetch(`${base}/replays`)).json()) as { id: string }[]
      expect(listed.map((one) => one.id)).toEqual([staying.id])
    })
  })

  it('lets only one of two simultaneous deletions carry it away', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)

    await withServer(appOn(api), async (base) => {
      const both = await Promise.all([remove(base, manifest.id), remove(base, manifest.id)])
      // The second is told someone holds the replay, which is truer than being
      // told there was nothing there.
      expect(both.map((one) => one.status).sort()).toEqual([204, 409])
    })
  })

  it('refuses while a build of it is under way here', async () => {
    const api = await anApi()

    await withServer(appOn(api, { publishTimeout: 20 }), async (base) => {
      const created = await post(base, { label: null, period: PERIOD })
      const { id } = (await created.json()) as ReplayManifest

      const refused = await remove(base, id)
      expect(refused.status).toBe(409)
      expect((await refused.json()) as Problem).toMatchObject({ type: 'conflict' })
    })
  })

  it('answers 404 for a replay nobody built', async () => {
    await withServer(appOn(await anApi()), async (base) => {
      const response = await remove(base, randomUUID())
      expect(response.status).toBe(404)
      expect((await response.json()) as Problem).toMatchObject({ type: 'not-found' })
    })
  })

  it('answers 404 the second time, having nothing left to remove', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)

    await withServer(appOn(api), async (base) => {
      expect((await remove(base, manifest.id)).status).toBe(204)
      expect((await remove(base, manifest.id)).status).toBe(404)
    })
  })
})

describe('what deletion must still reach', () => {
  it('removes a replay whose manifest its own contract refuses', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)
    await corruptManifest(api, manifest.id)

    await withServer(appOn(api), async (base) => {
      // The route that reads it fails; the route that removes it cannot, or
      // nothing ever cleans it up.
      expect((await fetch(`${base}/replays/${manifest.id}`)).status).toBe(500)
      expect((await remove(base, manifest.id)).status).toBe(204)
    })
    expect(await api.catalog.list()).toEqual([])
  })

  it('removes a replay a killed build left saying it was running', async () => {
    const api = await anApi()
    // The registry is empty after a restart; the manifest still says running,
    // and nothing but that registry ever knew a process was alive.
    const manifest = aManifest({ state: 'running' })
    await writeReplay(api, manifest)

    await withServer(appOn(api), async (base) => {
      expect((await remove(base, manifest.id)).status).toBe(204)
    })
  })
})

describe('refusing what cannot name a replay', () => {
  it('answers 400 without touching storage', async () => {
    const removed: string[] = []
    const catalog = aCatalog({
      remove: async (id: string) => {
        removed.push(id)
        return true
      },
    })

    await withServer(createApp({ catalog, launch: neverLaunches }), async (base) => {
      expect((await remove(base, encodeURIComponent('../secrets'))).status).toBe(400)
      expect(removed).toEqual([])
    })
  })
})
