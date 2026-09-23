import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { JournalEntry, ReplayManifest } from '@smmarchives/shared'
import { openPostgresStore } from '@smmarchives/worker/replay/postgres/store.ts'

import {
  aManifest,
  appOn,
  cleanRoots,
  closeDatabase,
  anApi,
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

/** Reads one stream as it arrives, rather than all of it at once. */
function following(response: Response) {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  const arrived: string[] = []

  /** The events completed by what just arrived, a heartbeat comment being none. */
  function eventsIn(received: string): string[] {
    buffered += received
    const chunks = buffered.split('\n\n')
    buffered = chunks.pop() ?? ''
    return chunks.filter((chunk) => !chunk.startsWith(':'))
  }

  return {
    /**
     * The next `count` events, or fewer if the stream ends or falls quiet —
     * the latter being how a test asserts that nothing more is coming, rather
     * than waiting for the runner to give up on it.
     */
    async take(count: number, quietMs = 200): Promise<string[]> {
      const taken: string[] = []
      while (taken.length < count) {
        const next = arrived.shift()
        if (next !== undefined) {
          taken.push(next)
          continue
        }
        const read = await Promise.race([
          reader.read(),
          new Promise<'quiet'>((settle) => setTimeout(() => settle('quiet'), quietMs)),
        ])
        if (read === 'quiet' || read.done) break
        arrived.push(...eventsIn(decoder.decode(read.value, { stream: true })))
      }
      return taken
    },
    close: () => reader.cancel(),
  }
}

function fieldOf(event: string, name: string): string {
  const line = event.split('\n').find((one) => one.startsWith(`${name}: `))
  return line === undefined ? '' : line.slice(name.length + 2)
}

const kindsOf = (events: string[]) => events.map((event) => fieldOf(event, 'event'))

/** A replay a build is still writing into, and the store that writes it. */
async function aBuildUnderWay(journal: JournalEntry[] = []) {
  const api = await anApi()
  const manifest = aManifest({ state: 'running' })
  await writeReplay(api, manifest, { journal })
  return {
    api,
    manifest,
    store: openPostgresStore({ pool: api.pool, replayId: manifest.id, mediaRoot: api.mediaRoot }),
  }
}

describe('following a build', () => {
  it('opens on the manifest, then carries the journal', async () => {
    const { api, manifest } = await aBuildUnderWay([started])

    await withServer(appOn(api, { pollIntervalMs: 10 }), async (base) => {
      const response = await fetch(`${base}/replays/${manifest.id}/progress`)
      expect(response.headers.get('content-type')).toContain('text/event-stream')

      const stream = following(response)
      const events = await stream.take(2)
      expect(kindsOf(events)).toEqual(['manifest', 'journal'])
      expect((JSON.parse(fieldOf(events[0] as string, 'data')) as ReplayManifest).id).toBe(
        manifest.id,
      )
      expect(fieldOf(events[1] as string, 'id')).toBe('0')
      expect(JSON.parse(fieldOf(events[1] as string, 'data'))).toEqual(started)
      await stream.close()
    })
  })

  it('carries what the build writes once the stream is open', async () => {
    const { api, manifest, store } = await aBuildUnderWay([started])

    await withServer(appOn(api, { pollIntervalMs: 10 }), async (base) => {
      const stream = following(await fetch(`${base}/replays/${manifest.id}/progress`))
      await stream.take(2)

      await store.putManifest({ ...manifest, updatedAt: '2026-09-10T06:04:12.004Z' })
      await store.appendJournal(done)

      // Both arrive; which of the two first is not promised, and asserting it
      // made this test fail once in a while for no defect. A pass reads the
      // manifest and the journal in two queries, so a write landing between
      // them is carried by two passes rather than one — and a reader keeps the
      // last manifest and appends the journal, whatever the order.
      const events = await stream.take(2)
      expect(kindsOf(events).sort()).toEqual(['journal', 'manifest'])
      const journal = events.find((event) => fieldOf(event, 'event') === 'journal')
      expect(fieldOf(journal as string, 'id')).toBe('1')
      await stream.close()
    })
  })

  it('sends the manifest again only when the build has moved on', async () => {
    const { api, manifest } = await aBuildUnderWay([started])

    await withServer(appOn(api, { pollIntervalMs: 10 }), async (base) => {
      const stream = following(await fetch(`${base}/replays/${manifest.id}/progress`))
      await stream.take(2)

      expect(await stream.take(1)).toEqual([])
      await stream.close()
    })
  })

  it('resumes after Last-Event-ID without replaying what was seen', async () => {
    const { api, manifest } = await aBuildUnderWay([started, done])

    await withServer(appOn(api, { pollIntervalMs: 10 }), async (base) => {
      const stream = following(
        await fetch(`${base}/replays/${manifest.id}/progress`, {
          headers: { 'last-event-id': '0' },
        }),
      )

      const events = await stream.take(3)
      expect(kindsOf(events)).toEqual(['manifest', 'journal'])
      expect(fieldOf(events[1] as string, 'id')).toBe('1')
      await stream.close()
    })
  })

  it('ends the stream once the build is no longer running', async () => {
    const api = await anApi()
    const manifest = aManifest({ state: 'partial' })
    await writeReplay(api, manifest, { journal: [started, done] })

    await withServer(appOn(api, { pollIntervalMs: 10 }), async (base) => {
      const stream = following(await fetch(`${base}/replays/${manifest.id}/progress`))

      const events = await stream.take(9)
      expect(kindsOf(events)).toEqual(['manifest', 'journal', 'journal', 'end'])
      expect(JSON.parse(fieldOf(events[3] as string, 'data'))).toEqual({ state: 'partial' })
    })
  })

  it('waits rather than calling a build failed when the replay goes away under it', async () => {
    const { api, manifest } = await aBuildUnderWay([started])

    await withServer(appOn(api, { pollIntervalMs: 10 }), async (base) => {
      const stream = following(await fetch(`${base}/replays/${manifest.id}/progress`))
      await stream.take(2)
      await api.catalog.remove(manifest.id)

      // Nothing more: a replay that vanished says nothing about how its build
      // ended, and `end` would be an answer the stream does not have.
      expect(await stream.take(1)).toEqual([])
      await stream.close()
    })
  })

  it('answers 404 on a replay nobody built', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/never-built/progress`)

      expect(response.status).toBe(404)
      expect(((await response.json()) as Problem).detail).toBe('no replay never-built')
    })
  })
})
