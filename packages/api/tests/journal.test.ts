import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { JournalEntry } from '@smmarchives/shared'

import {
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

const started: JournalEntry = {
  at: '2026-09-10T06:03:35.869Z',
  lane: 'radar-rainfall',
  kind: 'started',
}
const done: JournalEntry = { ...started, at: '2026-09-10T06:04:12.004Z', kind: 'done' }

/** The lines of an NDJSON body, an empty body being no line at all. */
function linesOf(body: string): string[] {
  return body === '' ? [] : body.trimEnd().split('\n')
}

const entriesIn = (body: string) => linesOf(body).map((line) => JSON.parse(line) as JournalEntry)

describe('reading the journal of a build', () => {
  it('serves it as NDJSON, one entry per line', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest, { journal: [started, done] })

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}/journal`)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/x-ndjson')
      expect(entriesIn(await response.text())).toEqual([started, done])
    })
  })

  it('starts from the line asked for, so a reader resumes without repeating', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest, { journal: [started, done] })

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}/journal?since=1`)

      expect(entriesIn(await response.text())).toEqual([done])
    })
  })

  it('answers an empty body for a build that journalled nothing', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}/journal`)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('')
    })
  })

  it('serves the trace of a build still under way, which has stored nothing', async () => {
    const api = await anApi()
    const manifest = aManifest({ state: 'running', lanes: {}, datasets: {} })
    await writeReplay(api, manifest, { journal: [started] })

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}/journal`)

      expect(response.status).toBe(200)
      expect(linesOf(await response.text())).toHaveLength(1)
    })
  })

  it('answers 404 on a replay nobody built', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const unknown = randomUUID()
      const response = await fetch(`${base}/replays/${unknown}/journal`)

      expect(response.status).toBe(404)
      expect(((await response.json()) as Problem).detail).toBe(`no replay ${unknown}`)
    })
  })

  it('answers 400 on a name that could address nothing', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      expect((await fetch(`${base}/replays/Aude%202019/journal`)).status).toBe(400)
    })
  })
})
