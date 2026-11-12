import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { JournalEntry, ReplayManifest } from '@smmarchives/shared'

import {
  aDataset,
  aManifest,
  anApi,
  appOn,
  cleanRoots,
  closeDatabase,
  writeReplay,
  type Api,
  type Problem,
} from './support/replay.ts'
import { withServer } from './support/server.ts'
import { asAdmin, sessionCookie } from './support/session.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

const JOURNAL: JournalEntry[] = [
  { at: '2026-09-10T06:00:00.000Z', lane: 'aquasys', kind: 'started' },
]

/** A replay holding something on every read route, published or not. */
async function aReplay(api: Api, overrides: Partial<ReplayManifest> = {}) {
  const { publishedAt: _, ...unpublished } = aManifest({ datasets: { measures: aDataset(0) } })
  const manifest = { ...unpublished, ...overrides }
  await writeReplay(api, manifest, {
    datasets: { measures: [] },
    media: { 'webcams/215/1.jpg': 'x' },
    journal: JOURNAL,
  })
  return manifest
}

const READS = [
  '/replays/:id',
  '/replays/:id/measures',
  '/replays/:id/media/webcams/215/1.jpg',
  '/replays/:id/journal',
]

function publish(base: string, id: string, method: 'PUT' | 'DELETE' = 'PUT') {
  return asAdmin(base, `/replays/${id}/publication`, { method })
}

async function listed(base: string, cookie?: string): Promise<string[]> {
  const response = await fetch(
    `${base}/replays`,
    cookie === undefined ? {} : { headers: { cookie } },
  )
  return ((await response.json()) as ReplayManifest[]).map((one) => one.id)
}

describe('an unpublished replay', () => {
  it.each(READS)('is unknown to a stranger at %s', async (path) => {
    const api = await anApi()
    const manifest = await aReplay(api)

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}${path.replace(':id', manifest.id)}`)
      expect(response.status).toBe(404)
      // In the words used for a replay that does not exist.
      expect(((await response.json()) as Problem).detail).toBe(`no replay ${manifest.id}`)
    })
  })

  it('is unknown to a stranger following its build', async () => {
    const api = await anApi()
    const manifest = await aReplay(api)

    await withServer(appOn(api), async (base) => {
      expect((await fetch(`${base}/replays/${manifest.id}/progress`)).status).toBe(404)
    })
  })

  it('is left out of what a stranger is listed', async () => {
    const api = await anApi()
    const hidden = await aReplay(api)
    const shown = aManifest()
    await writeReplay(api, shown)

    await withServer(appOn(api), async (base) => {
      expect(await listed(base)).toEqual([shown.id])
      expect((await listed(base, await sessionCookie(base))).sort()).toEqual(
        [hidden.id, shown.id].sort(),
      )
    })
  })

  it.each(READS)('is served to the administrator at %s', async (path) => {
    const api = await anApi()
    const manifest = await aReplay(api)

    await withServer(appOn(api), async (base) => {
      expect((await asAdmin(base, path.replace(':id', manifest.id))).status).toBe(200)
    })
  })

  it('is kept out of shared caches, even for the administrator', async () => {
    const api = await anApi()
    const manifest = await aReplay(api)

    await withServer(appOn(api), async (base) => {
      const medium = await asAdmin(base, `/replays/${manifest.id}/media/webcams/215/1.jpg`)
      expect(medium.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
      const dataset = await asAdmin(base, `/replays/${manifest.id}/measures`)
      expect(dataset.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate')
    })
  })
})

describe('a published replay', () => {
  it.each(READS)('is served to a stranger at %s', async (path) => {
    const api = await anApi()
    const manifest = await aReplay(api, { publishedAt: '2026-09-10T06:20:00.000Z' })

    await withServer(appOn(api), async (base) => {
      expect((await fetch(`${base}${path.replace(':id', manifest.id)}`)).status).toBe(200)
    })
  })

  it('lets shared caches keep its media', async () => {
    const api = await anApi()
    const manifest = await aReplay(api, { publishedAt: '2026-09-10T06:20:00.000Z' })

    await withServer(appOn(api), async (base) => {
      const medium = await fetch(`${base}/replays/${manifest.id}/media/webcams/215/1.jpg`)
      expect(medium.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    })
  })

  it('answers the listing for this session only', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      expect((await fetch(`${base}/replays`)).headers.get('cache-control')).toBe(
        'private, no-cache',
      )
    })
  })
})

describe('publishing', () => {
  it('opens a complete replay to strangers, and says when', async () => {
    const api = await anApi()
    const manifest = await aReplay(api)

    await withServer(appOn(api), async (base) => {
      const response = await publish(base, manifest.id)
      expect(response.status).toBe(200)
      expect(((await response.json()) as ReplayManifest).publishedAt).toBeDefined()

      expect((await fetch(`${base}/replays/${manifest.id}`)).status).toBe(200)
    })
  })

  it.each(['running', 'partial', 'failed'] as const)(
    'refuses a %s replay, and names its state',
    async (state) => {
      const api = await anApi()
      const manifest = await aReplay(api, { state })

      await withServer(appOn(api), async (base) => {
        const response = await publish(base, manifest.id)
        expect(response.status).toBe(409)
        expect(((await response.json()) as Problem).detail).toContain(state)

        expect((await fetch(`${base}/replays/${manifest.id}`)).status).toBe(404)
      })
    },
  )

  it('keeps the first date when asked twice', async () => {
    const api = await anApi()
    const manifest = await aReplay(api)

    await withServer(appOn(api), async (base) => {
      const first = (await (await publish(base, manifest.id)).json()) as ReplayManifest
      const again = (await (await publish(base, manifest.id)).json()) as ReplayManifest
      expect(again.publishedAt).toBe(first.publishedAt)
    })
  })

  it('answers 404 for a replay nobody built', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      expect((await publish(base, crypto.randomUUID())).status).toBe(404)
    })
  })

  it.each(['PUT', 'DELETE'])('%s is refused to a stranger', async (method) => {
    const api = await anApi()
    const manifest = await aReplay(api)

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}/publication`, { method })
      expect(response.status).toBe(401)
    })
  })
})

describe('withdrawing a publication', () => {
  it('hides the replay from strangers again', async () => {
    const api = await anApi()
    const manifest = await aReplay(api, { publishedAt: '2026-09-10T06:20:00.000Z' })

    await withServer(appOn(api), async (base) => {
      const response = await publish(base, manifest.id, 'DELETE')
      expect(response.status).toBe(200)
      expect(((await response.json()) as ReplayManifest).publishedAt).toBeUndefined()

      expect((await fetch(`${base}/replays/${manifest.id}`)).status).toBe(404)
    })
  })

  it('answers the same for a replay that was not published', async () => {
    const api = await anApi()
    const manifest = await aReplay(api)

    await withServer(appOn(api), async (base) => {
      expect((await publish(base, manifest.id, 'DELETE')).status).toBe(200)
    })
  })
})
