import type { JournalEntry, LaneName } from '@smmarchives/shared'

import type { ReplayStore } from './store.ts'

export type Journal = {
  record(lane: LaneName, kind: JournalEntry['kind'], message?: string): void
  /** A progress sink for a {@link ReportCollector}, tagged with its lane. */
  progressOf(lane: LaneName, echo: (message: string) => void): (message: string) => void
  /** Waits for every recorded entry to be written, and surfaces the first failure. */
  settled(): Promise<void>
}

/**
 * Records what a build does, as it does it.
 *
 * Writes are queued rather than awaited, because progress reaches this from a
 * synchronous sink deep inside the collectors. Queueing on one chain is what
 * keeps the file in the order things happened; a build that ends without
 * settling would leave its last lines unwritten.
 */
export function openJournal(store: ReplayStore): Journal {
  let written: Promise<void> = Promise.resolve()
  // Wrapped rather than held bare: a write rejected with `undefined` is still a
  // write that failed, and a bare field could not tell it from no failure.
  let failure: { reason: unknown } | undefined

  function record(lane: LaneName, kind: JournalEntry['kind'], message?: string): void {
    const at = new Date().toISOString()
    const entry: JournalEntry =
      message === undefined ? { at, lane, kind } : { at, lane, kind, message }

    // One chain, and only the first failure kept: a full disk would otherwise
    // report itself once per progress line.
    written = written
      .then(
        () => store.appendJournal(entry),
        () => {},
      )
      .catch((error: unknown) => {
        failure ??= { reason: error }
      })
  }

  return {
    record,

    progressOf(lane, echo) {
      return (message) => {
        echo(message)
        record(lane, 'progress', message)
      }
    },

    async settled() {
      await written
      if (failure !== undefined) throw failure.reason
    },
  }
}
