import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.ts'
import {
  aCatalog,
  aManifest,
  aStore,
  appOn,
  cleanRoots,
  closeDatabase,
  anApi,
  writeReplay,
  type Problem,
} from './support/replay.ts'
import { rawGet, withServer } from './support/server.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

const image = 'not really a photograph'
const raster = 'not really a raster'

async function aReplayWithMedia() {
  const api = await anApi()
  const manifest = aManifest()
  await writeReplay(api, manifest, {
    media: {
      'webcams/215/1571707711000.jpg': image,
      'radar/20034/pluvio5mn/1571707711.png': raster,
    },
  })
  return { mediaRoot: api.mediaRoot, id: manifest.id, app: appOn(api) }
}

describe('serving a frozen medium', () => {
  it('answers with the bytes the replay holds', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/media/webcams/215/1571707711000.jpg`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('image/jpeg')
      expect(await response.text()).toBe(image)
    })
  })

  it('reaches a medium however deep its path goes', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      const response = await fetch(
        `${base}/replays/${id}/media/radar/20034/pluvio5mn/1571707711.png`,
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('image/png')
      expect(await response.text()).toBe(raster)
    })
  })

  it('lets a frozen medium be kept for good', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${id}/media/webcams/215/1571707711000.jpg`)
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(response.headers.get('etag')).toMatch(/^"[^"]+"$/)
      await response.text()
    })
  })

  it.each([
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ])('names a .%s for what it is', async (extension, type) => {
    const api = await anApi()
    const manifest = aManifest()
    // The four a freeze can store: worker/src/replay/media.ts keeps these
    // extensions and rewrites anything else, so these are what arrives here.
    await writeReplay(api, manifest, { media: { [`webcams/215/1.${extension}`]: 'x' } })

    await withServer(appOn(api), async (base) => {
      const response = await fetch(
        `${base}/replays/${manifest.id}/media/webcams/215/1.${extension}`,
      )
      expect(response.headers.get('content-type')).toContain(type)
      expect(response.headers.get('content-disposition')).toBeNull()
      await response.text()
    })
  })

  it('hands over what it cannot name rather than letting a browser guess', async () => {
    const api = await anApi()
    const manifest = aManifest()
    // Big enough for the compression middleware to have taken it, had it been
    // mounted: an unnamed stream of bytes is the only output of this route it
    // would touch at all.
    const heavy = 'x'.repeat(4096)
    await writeReplay(api, manifest, { media: { 'webcams/215/notes.bin': heavy } })

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}/media/webcams/215/notes.bin`, {
        headers: { 'accept-encoding': 'gzip' },
      })
      expect(response.headers.get('content-type')).toContain('application/octet-stream')
      expect(response.headers.get('content-disposition')).toBe('attachment')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-encoding')).toBeNull()
      expect(response.headers.get('content-length')).toBe(String(heavy.length))
      await response.text()
    })
  })

  it('answers 304 to a client that already holds this medium', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      const url = `${base}/replays/${id}/media/webcams/215/1571707711000.jpg`
      const first = await fetch(url)
      const etag = first.headers.get('etag') as string
      await first.text()

      const again = await fetch(url, {
        headers: { 'if-none-match': etag, 'cache-control': 'max-age=0' },
      })
      expect(again.status).toBe(304)
      expect(again.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    })
  })
})

describe('refusing what is not a medium of this replay', () => {
  it.each([
    ['plain', '../../leak.txt'],
    ['percent-encoded dots', '%2e%2e/%2e%2e/leak.txt'],
    ['an encoded separator', '..%2f..%2fleak.txt'],
    ['an absolute path', '/etc/hosts'],
    ['an encoded absolute path', '%2Fetc%2Fhosts'],
  ])('refuses a path that would leave the replay, written with %s', async (_shape, path) => {
    const { mediaRoot, id, app } = await aReplayWithMedia()
    await writeFile(join(mediaRoot, 'leak.txt'), 'THE FILE NEXT DOOR')

    await withServer(app, async (base) => {
      const response = await rawGet(base, `/replays/${id}/media/${path}`)
      expect(response.status).toBe(400)
      expect((JSON.parse(response.body) as Problem).type).toBe('bad-request')
      expect(response.body).not.toContain('THE FILE NEXT DOOR')
    })
  })

  it('says nothing back about the path a client asked for', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      const response = await rawGet(base, `/replays/${id}/media/../../secret-name`)
      expect(response.body).not.toContain('secret-name')
    })
  })

  it('refuses a path carrying a byte no file name can hold', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      const response = await rawGet(base, `/replays/${id}/media/webcams/215/1.jpg%00.png`)
      expect(response.status).toBe(400)
    })
  })

  it('reports a storage failure as one, rather than as a bad path', async () => {
    const said: string[] = []
    const store = aStore({
      openMedia: async () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      },
    })
    const app = createApp({
      catalog: aCatalog({ open: async () => store }),
      log: (message) => said.push(message),
    })

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/aude-2019-10/media/webcams/1.jpg`)
      // A volume gone is not the client writing a bad path, and an operator
      // has to see it.
      expect(response.status).toBe(500)
    })
    expect(said.join('\n')).toContain('EACCES')
  })

  it('answers 400 on a request nobody could decode', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      // Express refuses the escape itself, carrying its own status; blaming
      // the server would log a stack for every crawler that tries one.
      const response = await rawGet(base, `/replays/${id}/media/%zz`)
      expect(response.status).toBe(400)
    })
  })

  it('answers 404 for a name that walks through a file', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      const response = await rawGet(base, `/replays/${id}/media/webcams/215/1571707711000.jpg/x`)
      expect(response.status).toBe(404)
    })
  })

  it('answers 404 for a medium the replay never froze', async () => {
    const { id, app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      expect((await fetch(`${base}/replays/${id}/media/webcams/999/1.jpg`)).status).toBe(404)
    })
  })

  it('answers 404 under a replay nobody built', async () => {
    await withServer(appOn(await anApi()), async (base) => {
      expect((await fetch(`${base}/replays/never-built/media/webcams/1/2.jpg`)).status).toBe(404)
    })
  })

  it('refuses an identifier no replay could carry', async () => {
    const { app } = await aReplayWithMedia()

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/replays/${encodeURIComponent('../x')}/media/a.jpg`)
      expect(response.status).toBe(400)
    })
  })
})

describe('the shape of a media path', () => {
  it('reaches one named by a single segment', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest, { media: { 'cover.png': 'x' } })

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}/media/cover.png`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('image/png')
      await response.text()
    })
  })
})
