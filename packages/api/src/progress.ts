import type { Express, Response } from 'express'

import type { JournalEntry, ReplayManifest } from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'
import type { ReplayStore } from '@smmarchives/worker/replay/store.ts'

import { notFound } from './problems.ts'
import { checkedReplayId } from './replays.ts'

/** Short enough that no proxy takes a quiet build for a dead connection. */
const HEARTBEAT_MS = 15_000

type ReplayState = ReplayManifest['state']

export function registerProgress(
  app: Express,
  catalog: ReplayCatalog,
  pollIntervalMs: number,
): void {
  // No `compression()` here, unlike the data set route: gzip holds a body back
  // until its buffer fills, and this one is written a line at a time.
  app.get('/replays/:id/progress', async (req, res) => {
    const { id } = req.params
    if (!checkedReplayId(res, id)) return

    // Not through `openReplay`, which asks for a manifest: a creation answers
    // before the build publishes one, telling the client to follow this.
    const store = await catalog.open(id)
    if (store === undefined) {
      notFound(res, `no replay ${id}`)
      return
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // nginx buffers a response body by default, which would hold every
      // event back until the build ended.
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()

    await follow(store, streamTo(res, resumedAt(req.headers['last-event-id'])), pollIntervalMs)
  })
}

/**
 * Pushes what a build writes, by reading what it wrote.
 *
 * Polled rather than watched: `fs.watch` answers differently from one platform
 * to the next, and it would put a file system notion inside a port a database
 * is meant to implement. The client is pushed to either way.
 */
async function follow(
  store: ReplayStore,
  stream: ProgressStream,
  pollIntervalMs: number,
): Promise<void> {
  const heartbeat = setInterval(() => stream.beat(), HEARTBEAT_MS)
  try {
    while (!stream.gone()) {
      const state = await pushWhatWasWritten(store, stream)
      if (state !== undefined) return stream.end(state)

      await new Promise((settle) => setTimeout(settle, pollIntervalMs))
    }
  } finally {
    clearInterval(heartbeat)
  }
}

/** Sends what the build wrote since the last pass, and its state once it is done. */
async function pushWhatWasWritten(
  store: ReplayStore,
  stream: ProgressStream,
): Promise<ReplayState | undefined> {
  const manifest = await store.getManifest()
  if (manifest !== undefined) stream.manifest(manifest)

  for (const entry of await store.readJournal(stream.line)) stream.journal(entry)

  // A replay with no manifest yet is a build in its first moments, since one
  // is published before anything is collected. Ending here would call a build
  // that is starting a build that failed.
  return manifest?.state === 'running' ? undefined : manifest?.state
}

type ProgressStream = ReturnType<typeof streamTo>

/** One client's stream, and what it has already been told. */
function streamTo(res: Response, from: number) {
  let line = from
  let published: string | undefined

  function write(head: string, event: string, data: unknown): void {
    if (!res.closed) res.write(`${head}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  return {
    /** The journal line this stream has yet to send. */
    get line(): number {
      return line
    },

    /**
     * Sent on opening, and again on every transition: a client connecting late
     * must not have to guess what it missed, and the lane states and media
     * counts a manifest carries are what feeds a progress bar.
     */
    manifest(manifest: ReplayManifest): void {
      if (manifest.updatedAt === published) return
      published = manifest.updatedAt
      write('', 'manifest', manifest)
    },

    /** Identified by its line number, which is what a resumption counts on. */
    journal(entry: JournalEntry): void {
      write(`id: ${line}\n`, 'journal', entry)
      line += 1
    },

    end(state: ReplayState): void {
      write('', 'end', { state })
      res.end()
    },

    /** A comment, which every client ignores and every proxy counts as traffic. */
    beat(): void {
      if (!res.closed) res.write(':\n\n')
    },

    /** The client hung up: nothing more to send, and nothing more to read for. */
    gone(): boolean {
      return res.closed
    },
  }
}

/** Where a reconnecting client left off: the line after the last one it saw. */
function resumedAt(lastEventId: string | string[] | undefined): number {
  const seen = Number(lastEventId)
  return Number.isInteger(seen) && seen >= 0 ? seen + 1 : 0
}
