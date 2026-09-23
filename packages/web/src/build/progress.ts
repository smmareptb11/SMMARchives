import { journalEntrySchema, replayManifestSchema } from '@smmarchives/shared/contracts/replay.ts'
import type { JournalEntry, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

/** The three events `GET /replays/:id/progress` sends, and nothing else. */
export type StreamEvent =
  | { event: 'manifest'; data: unknown }
  | { event: 'journal'; data: unknown }
  | { event: 'end'; data: unknown }

export type BuildState = {
  manifest: ReplayManifest | undefined
  journal: JournalEntry[]
  /** The state the build settled on, or undefined while it is still running. */
  ended: ReplayManifest['state'] | undefined
}

export const EMPTY: BuildState = { manifest: undefined, journal: [], ended: undefined }

/**
 * How much of the trace the screen holds.
 *
 * A build of three days writes thousands of lines, and a page that kept them
 * all would grow until the browser gave up. The tail is what an operator reads
 * while it runs; the whole journal stays one route away.
 */
export const JOURNAL_KEPT = 500

/**
 * What one event does to the screen.
 *
 * Checked against the contracts rather than trusted: this is the one place a
 * value crosses into the browser from outside it, and an event nobody can read
 * leaves the screen as it was instead of emptying it.
 */
export function reduceProgress(state: BuildState, event: StreamEvent): BuildState {
  if (event.event === 'manifest') {
    const manifest = replayManifestSchema.safeParse(event.data)
    return manifest.success ? { ...state, manifest: manifest.data } : state
  }

  if (event.event === 'journal') {
    const entry = journalEntrySchema.safeParse(event.data)
    if (!entry.success) return state
    return { ...state, journal: [...state.journal, entry.data].slice(-JOURNAL_KEPT) }
  }

  const ended = replayManifestSchema.shape.state.safeParse(
    (event.data as { state?: unknown } | null)?.state,
  )
  return ended.success ? { ...state, ended: ended.data } : state
}

/**
 * Follows a build, and answers how to stop following it.
 *
 * The reconnection is the browser's: `EventSource` sends `Last-Event-ID` back
 * on its own and the stream resumes on the line after the last one seen — so
 * nothing here replays the journal, which would double every line on screen.
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
  source.addEventListener('end', (message: MessageEvent<string>) => {
    apply('end')(message)
    // The server closes after this one; closing here as well stops the browser
    // from reconnecting to a stream that has nothing left to say.
    source.close()
  })

  return () => source.close()
}
