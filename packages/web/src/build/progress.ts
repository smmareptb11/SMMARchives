import { journalEntrySchema, replayManifestSchema } from '@smmarchives/shared/contracts/replay.ts'
import type { JournalEntry, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

/**
 * The two events of `GET /replays/:id/progress` that change the screen. The
 * third, `end`, closes the stream and says nothing the last manifest did not.
 */
export type StreamEvent = { event: 'manifest'; data: unknown } | { event: 'journal'; data: unknown }

export type BuildState = {
  manifest: ReplayManifest | undefined
  journal: JournalEntry[]
}

export const EMPTY: BuildState = { manifest: undefined, journal: [] }

/**
 * How much of the trace the screen holds: a long build writes more lines than a
 * page can keep, and the whole journal stays one route away.
 */
export const JOURNAL_KEPT = 500

/**
 * What one event does to the screen, checked against the contracts rather than
 * trusted: an event nobody can read leaves the screen as it was.
 */
export function reduceProgress(state: BuildState, event: StreamEvent): BuildState {
  if (event.event === 'manifest') {
    const manifest = replayManifestSchema.safeParse(event.data)
    return manifest.success ? { ...state, manifest: manifest.data } : state
  }

  const entry = journalEntrySchema.safeParse(event.data)
  if (!entry.success) return state
  return { ...state, journal: [...state.journal, entry.data].slice(-JOURNAL_KEPT) }
}

/**
 * Follows a build, and answers how to stop following it. `EventSource` resumes
 * on its own after the last line seen, so nothing here replays the journal,
 * which would double every line on screen.
 */
export function followBuild(id: string, onChange: (state: BuildState) => void): () => void {
  const source = new EventSource(`/replays/${id}/progress`)
  let state = EMPTY

  const apply = (event: StreamEvent['event']) => (message: MessageEvent<string>) => {
    state = reduceProgress(state, { event, data: JSON.parse(message.data) as unknown })
    onChange(state)
  }
  source.addEventListener('manifest', apply('manifest'))
  source.addEventListener('journal', apply('journal'))
  source.addEventListener('end', () => {
    // The server closes after this one; closing here as well stops the browser
    // from reconnecting to a stream that has nothing left to say.
    source.close()
  })

  return () => source.close()
}

/**
 * How far from the bottom a journal still counts as read to its last line, in
 * pixels: a scroll position is fractional on a high-density screen, and the
 * bottom is seldom reached to the exact pixel.
 */
const AT_END_TOLERANCE = 4

/**
 * Whether the reader is on the last line of the journal, which is what decides
 * if the next line carries them down with it. Scrolled up, they are reading,
 * and a line arriving must not take the page from under them.
 */
export function isAtEnd(box: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return box.scrollHeight - box.clientHeight - box.scrollTop <= AT_END_TOLERANCE
}

/**
 * Reads a replay, then follows its build when one is under way, and answers how
 * to stop, whichever of the two it has reached. A reader who leaves before the
 * manifest comes back follows nothing: nobody would be left to close the stream.
 */
export function readThenFollow(
  read: () => Promise<ReplayManifest>,
  follow: () => () => void,
  on: { read: (manifest: ReplayManifest) => void; failed: (error: unknown) => void },
): () => void {
  let stop: (() => void) | undefined
  let left = false
  read().then(
    (manifest) => {
      if (left) return
      on.read(manifest)
      if (manifest.state === 'running') stop = follow()
    },
    (error: unknown) => {
      if (!left) on.failed(error)
    },
  )
  return () => {
    left = true
    stop?.()
  }
}
