import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { ReplayEvent } from '@smmarchives/shared'

import { PHOTO_COUNT_LIMIT, PHOTO_SIZE_LIMIT } from '../src/uploads.ts'
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

const EVENT = {
  title: 'Champ inondé',
  producerKind: 'Particulier',
  from: '2019-10-22T09:00:00Z',
}

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6])

async function aReplay() {
  const api = await anApi()
  const manifest = aManifest({ datasets: { events: aDataset(0) } })
  await writeReplay(api, manifest, { datasets: { events: [] } })
  return { api, id: manifest.id }
}

/** A form as a browser builds one, its parts in the order given. */
function aForm(parts: [string, string | Blob, string?][]): FormData {
  const form = new FormData()
  for (const [name, value, filename] of parts) {
    if (typeof value === 'string') form.append(name, value)
    else form.append(name, value, filename)
  }
  return form
}

const event = (body: unknown = EVENT): [string, string] => ['event', JSON.stringify(body)]
const photo = (
  bytes: Uint8Array,
  type = 'image/jpeg',
  name = 'photo.jpg',
): [string, Blob, string] => ['photo', new Blob([bytes], { type }), name]

function send(base: string, id: string, body: FormData | string, type?: string) {
  return fetch(`${base}/replays/${id}/events`, {
    method: 'POST',
    ...(type === undefined ? {} : { headers: { 'content-type': type } }),
    body,
  })
}

async function eventsOf(base: string, id: string): Promise<ReplayEvent[]> {
  return (await (await fetch(`${base}/replays/${id}/events`)).json()) as ReplayEvent[]
}

describe('joining photos to an event', () => {
  it('keeps them in the order sent, served under the type their bytes declare', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, aForm([event(), photo(JPEG), photo(PNG, 'image/png')]))
      expect(response.status).toBe(201)
      const { media } = (await response.json()) as ReplayEvent
      expect(media).toEqual([
        expect.stringMatching(/^field-reports\/[0-9a-f-]{36}\/1\.jpg$/),
        expect.stringMatching(/^field-reports\/[0-9a-f-]{36}\/2\.png$/),
      ])

      const served = await fetch(`${base}/replays/${id}/media/${media[1]}`)
      expect(served.headers.get('content-type')).toBe('image/png')
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG)
      expect((await eventsOf(base, id))[0]?.media).toEqual(media)
    })
  })

  it('names a JPEG a JPEG, whatever the client called it', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, aForm([event(), photo(JPEG, 'image/png', 'x.png')]))
      expect(((await response.json()) as ReplayEvent).media[0]).toMatch(/\/1\.jpg$/)
    })
  })

  it('takes a form with no photo', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, aForm([event()]))
      expect(response.status).toBe(201)
      expect(((await response.json()) as ReplayEvent).media).toEqual([])
    })
  })
})

describe('refusing photos', () => {
  it('refuses a page dressed as a photo, without repeating its name', async () => {
    const { api, id } = await aReplay()
    const page = new TextEncoder().encode('<!doctype html><script>alert(1)</script>')

    await withServer(appOn(api), async (base) => {
      const response = await send(
        base,
        id,
        aForm([event(), photo(page, 'image/png', 'plan-secret.png')]),
      )
      expect(response.status).toBe(415)
      expect(await response.text()).not.toContain('plan-secret')
      expect(await eventsOf(base, id)).toEqual([])
    })
  })

  it('refuses a photo past the size limit', async () => {
    const { api, id } = await aReplay()
    const heavy = new Uint8Array(PHOTO_SIZE_LIMIT + 1)
    heavy.set(JPEG)

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, aForm([event(), photo(heavy)]))
      expect(response.status).toBe(413)
      expect(((await response.json()) as Problem).detail).toBe('a photo weighs 15 MB at most')
    })
  })

  it('refuses one photo too many', async () => {
    const { api, id } = await aReplay()
    const photos = Array.from({ length: PHOTO_COUNT_LIMIT + 1 }, () => photo(JPEG))

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, aForm([event(), ...photos]))
      expect(response.status).toBe(413)
      expect(await eventsOf(base, id)).toEqual([])
    })
  })

  it('refuses an event part past the size the JSON route accepts', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await send(
        base,
        id,
        aForm([event({ ...EVENT, description: 'x'.repeat(70_000) })]),
      )
      expect(response.status).toBe(413)
    })
  })

  it('refuses a photo sent before its event', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, aForm([photo(JPEG), event()]))
      expect(response.status).toBe(400)
      expect(((await response.json()) as Problem).detail).toBe('the event comes before its photos')
    })
  })

  it('writes nothing for an event it refuses', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, aForm([event({ ...EVENT, title: '' }), photo(JPEG)]))
      expect(response.status).toBe(400)
      expect(((await response.json()) as { refusals: { path: string }[] }).refusals).toEqual([
        expect.objectContaining({ path: 'title' }),
      ])
    })
    expect(existsSync(join(api.mediaRoot, id, 'field-reports'))).toBe(false)
  })

  it('refuses a part it does not know', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, aForm([event(), ['note', 'urgent']]))
      expect(response.status).toBe(400)
    })
  })

  it('refuses a body that is neither JSON nor a form', async () => {
    const { api, id } = await aReplay()

    await withServer(appOn(api), async (base) => {
      const response = await send(base, id, JSON.stringify(EVENT), 'text/plain')
      expect(response.status).toBe(415)
    })
  })
})
