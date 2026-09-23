/* eslint-disable max-lines -- one file per route, and this one answers in five ways: serving,
   freshness, the bytes on the wire, the interruption, narrowing. Cut by length, a reader stops
   finding them together. */
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { DatasetName } from '@smmarchives/shared'

import { openPostgresStore } from '@smmarchives/worker/replay/postgres/store.ts'
import type { StoredBlob } from '@smmarchives/worker/replay/store.ts'

import { createApp } from '../src/app.ts'
import {
  aCatalog,
  aDataset,
  aManifest,
  anApi,
  aStore,
  appOn,
  cleanRoots,
  closeDatabase,
  writeReplay,
  type Problem,
} from './support/replay.ts'
import { withServer } from './support/server.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

const measures = [
  { sourceId: 1, quantity: 'level', at: '2019-10-22T06:00:00.000Z', value: 1.25 },
  { sourceId: 1, quantity: 'level', at: '2019-10-22T06:05:00.000Z', value: 1.31 },
]

/** A replay holding one data set, and what a reader will be served for it. */
async function aReplayWith(name: DatasetName, rows: unknown) {
  const api = await anApi()
  const manifest = aManifest({ datasets: { [name]: aDataset(name, countOf(rows)) } })
  await writeReplay(api, manifest, { datasets: { [name]: rows } })

  const store = openPostgresStore({
    pool: api.pool,
    replayId: manifest.id,
    mediaRoot: api.mediaRoot,
  })
  const stored = JSON.stringify(await store.getDataset(name))
  return { api, id: manifest.id, stored, app: appOn(api) }
}

const aReplayWithMeasures = () => aReplayWith('measures', measures)

/** A data set is not always an array: the referential is one object of two. */
function countOf(rows: unknown): number {
  return Array.isArray(rows) ? rows.length : 0
}

/**
 * What a browser sends on an ordinary conditional request.
 *
 * `fetch` attaches `cache-control: no-cache` of its own to any request
 * carrying a validator, and the API honours it — so a test that left it there
 * would be asking for the body, not for a revalidation.
 */
function revalidating(ifNoneMatch: string): Record<string, string> {
  return { 'if-none-match': ifNoneMatch, 'cache-control': 'max-age=0' }
}

describe('serving a data set', () => {
  it('answers with the stored bytes, unchanged', async () => {
    const { id, stored, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/measures`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      // Every answer this API gives is bytes a source outside it produced.
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await response.text()).toBe(stored)
    })
  })

  it('revalidates rather than freezing what a re-run may rewrite', async () => {
    const { id, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const first = await fetch(`${base}/replays/${id}/measures`)
      expect(first.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
      const etag = first.headers.get('etag')
      expect(etag).toMatch(/^"[^"]+"$/)
      await first.text()

      const again = await fetch(`${base}/replays/${id}/measures`, {
        headers: revalidating(etag as string),
      })
      expect(again.status).toBe(304)
      expect(await again.text()).toBe('')
    })
  })

  it('changes its ETag when a re-run rewrites the data set', async () => {
    const { api, id, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const before = await fetch(`${base}/replays/${id}/measures`)
      const etag = before.headers.get('etag')
      await before.text()

      // A re-run replaces the rows whole, which is what the version follows.
      await writeReplay(api, aManifest({ id, datasets: { measures: aDataset('measures', 1) } }), {
        datasets: {
          measures: [{ sourceId: 2, quantity: 'level', at: '2019-10-22T07:00:00.000Z', value: 9 }],
        },
      })

      const after = await fetch(`${base}/replays/${id}/measures`, {
        headers: revalidating(etag as string),
      })
      expect(after.status).toBe(200)
      expect(after.headers.get('etag')).not.toBe(etag)
    })
  })

  it('answers 404 for a data set no lane produced', async () => {
    const { id, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/webcam-images`)
      expect(response.status).toBe(404)
      expect((await response.json()) as Problem).toMatchObject({
        detail: `replay ${id} holds no webcam-images`,
      })
    })
  })

  it('names no data set back to a client that invented one', async () => {
    const { id, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/${encodeURIComponent('../../secret')}`)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      expect(JSON.stringify(await response.json())).not.toContain('secret')
    })
  })

  it('answers 404 for a data set of a replay nobody built', async () => {
    await withServer(appOn(await anApi()), async (base) => {
      expect((await fetch(`${base}/replays/${randomUUID()}/measures`)).status).toBe(404)
    })
  })

  it('refuses an identifier no replay could carry, without touching storage', async () => {
    const catalog = aCatalog({ open: vi.fn(async () => undefined) })

    await withServer(createApp({ catalog }), async (base) => {
      const response = await fetch(`${base}/replays/${encodeURIComponent('../x')}/measures`)
      expect(response.status).toBe(400)
      /* eslint-disable-next-line @typescript-eslint/unbound-method -- handed to `expect`, never
         called: no `this` is involved */
      expect(catalog.open).not.toHaveBeenCalled()
    })
  })

  it('serves a data set a lane collected empty, which is not the same as none', async () => {
    // Told apart by the manifest alone: a lane that collected nothing and a
    // lane that never ran hold the same number of rows.
    const { id, app } = await aReplayWith('measures', [])

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/measures`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([])
    })
  })
})

describe('the freshness a client claims', () => {
  it('sends the data set again when the copy it holds is not this one', async () => {
    const { id, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/measures`, {
        headers: revalidating('"an-older-version"'),
      })
      expect(response.status).toBe(200)
      expect(JSON.parse(await response.text())).toEqual(measures)
    })
  })

  it('answers 304 to a client that says it already holds any version', async () => {
    const { id, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/measures`, {
        headers: revalidating('*'),
      })
      expect(response.status).toBe(304)
    })
  })

  it('answers 304 on a list of tags that holds this one', async () => {
    const { id, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const first = await fetch(`${base}/replays/${id}/measures`)
      const etag = first.headers.get('etag') as string
      await first.text()

      const again = await fetch(`${base}/replays/${id}/measures`, {
        headers: revalidating(`"another", ${etag}`),
      })
      expect(again.status).toBe(304)
    })
  })

  it('sends the whole data set to a client that asks for no cache', async () => {
    const { id, stored, app } = await aReplayWithMeasures()

    await withServer(app, async (base) => {
      const first = await fetch(`${base}/replays/${id}/measures`)
      const etag = first.headers.get('etag') as string
      await first.text()

      // What a reload does. The validator is there, and it is overruled on
      // purpose: the client is asking to be told again.
      const again = await fetch(`${base}/replays/${id}/measures`, {
        headers: { 'if-none-match': etag, 'cache-control': 'no-cache' },
      })
      expect(again.status).toBe(200)
      expect(await again.text()).toBe(stored)
    })
  })
})

describe('the bytes on the wire', () => {
  // Past the 1 kB the compression middleware waits for, and accented, so a
  // length counted in characters would not pass for one counted in bytes.
  const referential = {
    stations: Array.from({ length: 40 }, (_, index) => ({
      id: index,
      code: `Y16120${index}`,
      name: `L'Aude à Trèbes ${index}`,
      comment: null,
      townCode: '11399',
      altitude: null,
      position: null,
      category: 'watercourse' as const,
      categoryIsFallback: false,
      quantities: null,
    })),
    rainGauges: [],
  }
  const aBigReplay = () => aReplayWith('stations', referential)

  it('compresses a data set worth compressing, and the client still reads the stored bytes', async () => {
    const { id, stored, app } = await aBigReplay()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/stations`, {
        headers: { 'accept-encoding': 'gzip' },
      })
      expect(response.headers.get('content-encoding')).toBe('gzip')
      expect(response.headers.get('vary')).toContain('Accept-Encoding')
      // Left in place it would announce the uncompressed length and truncate.
      expect(response.headers.get('content-length')).toBeNull()
      expect(await response.text()).toBe(stored)
    })
  })

  it('announces the exact byte length when the client takes it as it is', async () => {
    const { id, stored, app } = await aBigReplay()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/stations`, {
        headers: { 'accept-encoding': 'identity' },
      })
      expect(response.headers.get('content-encoding')).toBeNull()
      // Accented labels: a length counted in characters would fall short here.
      expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(stored)))
      expect(await response.text()).toBe(stored)
    })
  })
})

describe('when the bytes stop coming', () => {
  function catalogServing(blob: StoredBlob) {
    // The manifest carries the data set, since that is what the route asks
    // before it asks storage for anything.
    return aCatalog({
      open: async () =>
        aStore({
          getManifest: async () => aManifest({ datasets: { measures: aDataset('measures', 1) } }),
          openDataset: async () => blob,
        }),
    })
  }

  it('cuts the response and keeps the process alive', async () => {
    let reads = 0
    const failing: StoredBlob = {
      size: 1_000_000,
      version: 'v1',
      body: new Readable({
        read() {
          // A first chunk sends the headers; the failure then lands where
          // nothing can be said in the response any more. The wait is what
          // puts it there: a stream reads ahead, so an immediate failure
          // would outrun the chunk it is supposed to follow.
          if (reads++ > 0) return
          this.push(Buffer.alloc(4096))
          setTimeout(() => this.destroy(new Error('the volume went away mid-read')), 50)
        },
      }),
    }
    const said: string[] = []
    const app = createApp({ catalog: catalogServing(failing), log: (m) => said.push(m) })

    await withServer(app, async (base) => {
      // Uncompressed: gzip holds everything until it ends, so nothing would
      // reach the client and there would be no "after the headers" to test.
      const response = await fetch(`${base}/replays/aude-2019-10/measures`, {
        headers: { 'accept-encoding': 'identity' },
      })
      expect(response.status).toBe(200)
      await expect(response.text()).rejects.toThrow()

      await vi.waitFor(() => expect(said.join('\n')).toContain('the volume went away mid-read'))
    })
  })

  it('answers a HEAD without reading the body it would have sent', async () => {
    let read = false
    const watched: StoredBlob = {
      size: 42,
      version: 'v1',
      body: new Readable({
        read() {
          read = true
          this.push(null)
        },
      }),
    }

    await withServer(createApp({ catalog: catalogServing(watched) }), async (base) => {
      const response = await fetch(`${base}/replays/aude-2019-10/measures`, { method: 'HEAD' })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-length')).toBe('42')
      expect(await response.text()).toBe('')
    })
    // Express answers HEAD through the GET handler; 19 MB read to be thrown
    // away is the whole cost of the request.
    expect(read).toBe(false)
  })

  it('says nothing when a client walks away, which is not a failure', async () => {
    const said: string[] = []
    const endless: StoredBlob = {
      size: 1_000_000,
      version: 'v1',
      body: new Readable({
        read() {
          this.push(Buffer.alloc(1024))
        },
      }),
    }

    await withServer(
      createApp({ catalog: catalogServing(endless), log: (m) => said.push(m) }),
      async (base) => {
        const abort = new AbortController()
        const response = await fetch(`${base}/replays/aude-2019-10/measures`, {
          signal: abort.signal,
        })
        await (response.body as ReadableStream<Uint8Array>).getReader().read()
        abort.abort()
      },
    )
    expect(said).toEqual([])
  })

  it('lets go of the stored bytes when the client walks away mid-download', async () => {
    let released = false
    const endless: StoredBlob = {
      size: 1_000_000,
      version: 'v1',
      body: new Readable({
        read() {
          this.push(Buffer.alloc(1024))
        },
        destroy(error, done) {
          released = true
          done(error)
        },
      }),
    }
    const app = createApp({ catalog: catalogServing(endless) })

    await withServer(app, async (base) => {
      const abort = new AbortController()
      const response = await fetch(`${base}/replays/aude-2019-10/measures`, {
        signal: abort.signal,
      })
      await (response.body as ReadableStream<Uint8Array>).getReader().read()
      abort.abort()

      await vi.waitFor(() => expect(released).toBe(true))
    })
  })
})

describe('narrowing a data set', () => {
  const series = [
    { sourceId: 84, quantity: 'level', at: '2019-10-22T06:00:00.000Z', value: 1 },
    { sourceId: 84, quantity: 'level', at: '2019-10-22T07:00:00.000Z', value: 2 },
    { sourceId: 91, quantity: 'level', at: '2019-10-22T06:00:00.000Z', value: 7 },
  ]

  it('serves one station without the others', async () => {
    const { id, app } = await aReplayWith('measures', series)

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/measures?source=91`)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([series[2]])
    })
  })

  it('serves one window without what falls outside it', async () => {
    const { id, app } = await aReplayWith('measures', series)

    await withServer(app, async (base) => {
      const response = await fetch(
        `${base}/replays/${id}/measures?from=2019-10-22T06:30:00Z&to=2019-10-22T08:00:00Z`,
      )

      expect((await response.json()) as unknown[]).toHaveLength(1)
    })
  })

  it('gives two questions two validators, so neither answers for the other', async () => {
    const { id, app } = await aReplayWith('measures', series)

    await withServer(app, async (base) => {
      const whole = await fetch(`${base}/replays/${id}/measures`)
      await whole.text()
      const narrowed = await fetch(`${base}/replays/${id}/measures?source=91`)
      await narrowed.text()

      expect(narrowed.headers.get('etag')).not.toBe(whole.headers.get('etag'))
    })
  })

  it('refuses a window whose end precedes its start', async () => {
    const { id, app } = await aReplayWith('measures', series)

    await withServer(app, async (base) => {
      const response = await fetch(
        `${base}/replays/${id}/measures?from=2019-10-23T00:00:00Z&to=2019-10-22T00:00:00Z`,
      )

      expect(response.status).toBe(400)
    })
  })

  it('refuses a filter the data set knows nothing about, rather than ignoring it', async () => {
    const { id, app } = await aReplayWith('measures', series)

    await withServer(app, async (base) => {
      // Served the whole set instead, a client that misspelled `source` would
      // read a station it never asked for as if it had.
      const response = await fetch(`${base}/replays/${id}/measures?sourceId=91`)

      expect(response.status).toBe(400)
      expect((await response.json()) as Problem).toMatchObject({ type: 'bad-request' })
    })
  })

  it('refuses any filter on a data set that takes none', async () => {
    const { id, app } = await aReplayWith('thresholds', [])

    await withServer(app, async (base) => {
      expect((await fetch(`${base}/replays/${id}/thresholds?source=84`)).status).toBe(400)
    })
  })
})
