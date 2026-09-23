import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { openPostgresCatalog } from '@smmarchives/worker/replay/postgres/catalog.ts'

import { createApp } from '../src/app.ts'
import {
  aCatalog,
  aManifest,
  anApi,
  appOn,
  cleanRoots,
  closeDatabase,
  corruptManifest,
  writeReplay,
  type Problem,
} from './support/replay.ts'
import { withServer } from './support/server.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

describe('listing replays', () => {
  it('answers an empty list on a database nothing has been built into', async () => {
    await withServer(appOn(await anApi()), async (base) => {
      const response = await fetch(`${base}/replays`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([])
    })
  })

  it('keeps listing the sound replays when one manifest is unreadable', async () => {
    const api = await anApi()
    const sound = aManifest()
    const broken = aManifest()
    await writeReplay(api, sound)
    await writeReplay(api, broken)
    await corruptManifest(api, broken.id)

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays`)
      expect(response.status).toBe(200)

      const listed = (await response.json()) as { id: string }[]
      expect(listed.map((one) => one.id)).toEqual([sound.id])
    })
  })

  it('reports the replay it left out, rather than dropping it in silence', async () => {
    const api = await anApi()
    const broken = aManifest()
    await writeReplay(api, broken)
    await corruptManifest(api, broken.id)
    const said: string[] = []

    const app = createApp({
      catalog: openPostgresCatalog({
        pool: api.pool,
        mediaRoot: api.mediaRoot,
        onProgress: (message) => said.push(message),
      }),
    })
    await withServer(app, async (base) => {
      await fetch(`${base}/replays`)
    })
    expect(said).toEqual([
      `replay ${broken.id} holds a manifest its contract refuses, and it is left out of the listing`,
    ])
  })

  it('answers newest first, whatever order the rows come back in', async () => {
    const api = await anApi()
    const older = aManifest({ createdAt: '2026-09-01T00:00:00.000Z' })
    const newer = aManifest({ createdAt: '2026-09-08T00:00:00.000Z' })
    await writeReplay(api, older)
    await writeReplay(api, newer)

    await withServer(appOn(api), async (base) => {
      const listed = (await (await fetch(`${base}/replays`)).json()) as { id: string }[]
      expect(listed.map((one) => one.id)).toEqual([newer.id, older.id])
    })
  })
})

describe('reading one replay', () => {
  it('serves its manifest whole', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(manifest)
    })
  })

  it('answers 404 for a replay nobody built', async () => {
    const api = await anApi()
    const unknown = randomUUID()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${unknown}`)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      expect((await response.json()) as Problem).toMatchObject({
        type: 'not-found',
        detail: `no replay ${unknown}`,
      })
    })
  })

  it('never creates a replay by reading one', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      expect((await fetch(`${base}/replays/${randomUUID()}`)).status).toBe(404)
      expect(await (await fetch(`${base}/replays`)).json()).toEqual([])
    })
  })

  it('answers 404 on a name it could never have minted', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/aude-2019-10`)
      expect(response.status).toBe(404)
    })
  })

  it('refuses to serve a manifest its own contract rejects, without saying why', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)
    await corruptManifest(api, manifest.id)
    const said: string[] = []

    const app = createApp({
      catalog: api.catalog,
      log: (message) => said.push(message),
    })
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}`)
      expect(response.status).toBe(500)

      const problem = (await response.json()) as Problem
      expect(problem.detail).toBe('the request could not be served')
      expect(JSON.stringify(problem)).not.toContain('bizarre')
    })

    // What the response withholds has to be somewhere, cause included.
    expect(said.join('\n')).toContain('holds a manifest its contract refuses')
    expect(said.join('\n')).toContain('caused by')
  })
})

describe('refusing what cannot name a replay', () => {
  it('answers 400 without reaching storage', async () => {
    const catalog = aCatalog({ open: vi.fn(async () => undefined) })

    await withServer(createApp({ catalog }), async (base) => {
      const response = await fetch(`${base}/replays/${encodeURIComponent('../secrets')}`)
      expect(response.status).toBe(400)
      expect((await response.json()) as Problem).toMatchObject({ type: 'bad-request' })
      /* eslint-disable-next-line @typescript-eslint/unbound-method -- handed to `expect`, never
         called: no `this` is involved */
      expect(catalog.open).not.toHaveBeenCalled()
    })
  })
})

describe('the rest of the surface', () => {
  it('answers on /health', async () => {
    await withServer(appOn(await anApi()), async (base) => {
      const response = await fetch(`${base}/health`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok' })
    })
  })

  it('answers a problem document on a route that does not exist', async () => {
    await withServer(appOn(await anApi()), async (base) => {
      const response = await fetch(`${base}/nowhere`)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      expect((await response.json()) as Problem).toMatchObject({ detail: 'no route here' })
    })
  })
})
