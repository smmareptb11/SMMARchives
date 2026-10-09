import type { JournalEntry } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { openJournal } from '../src/replay/journal.ts'
import type { ReplayStore } from '../src/replay/store.ts'

/**
 * Progress reaches the journal from a synchronous sink deep inside the
 * collectors, so entries are queued rather than awaited. What that queueing has
 * to guarantee is tested here; what the journal holds once written, and how it
 * reads back, is in `replay-postgres-journal.test.ts`.
 */
function storeThat(appendJournal: ReplayStore['appendJournal']): ReplayStore {
  return {
    appendJournal,
    readJournal: async () => [],
    getDataset: async () => undefined,
    openDataset: async () => undefined,
    putDataset: async () => {},
    getManifest: async () => undefined,
    putManifest: async () => {},
    hasMedia: async () => false,
    openMedia: async () => undefined,
    putMedia: async () => {},
    removeMedia: async () => {},
    addManualEvent: async () => {
      throw new Error('no event is added here')
    },
    getEvent: async () => undefined,
    attachEventMedia: async () => false,
  }
}

describe('entries recorded without being awaited', () => {
  it('are written in the order they happened', async () => {
    const written: string[] = []
    const journal = openJournal(
      storeThat(async (entry: JournalEntry) => {
        // A slow first write would let a later one overtake it without the queue.
        await new Promise((resolve) => setTimeout(resolve, written.length === 0 ? 10 : 0))
        written.push(entry.kind)
      }),
    )

    journal.record('radar-rainfall', 'started')
    journal.record('radar-rainfall', 'progress', 'delivery 20044…')
    journal.record('radar-rainfall', 'done')
    await journal.settled()

    expect(written).toEqual(['started', 'progress', 'done'])
  })

  it('are all written by the time the build settles', async () => {
    const written: string[] = []
    const journal = openJournal(storeThat(async (entry) => void written.push(entry.kind)))

    journal.record('media', 'started')
    journal.record('media', 'done')
    await journal.settled()

    expect(written).toHaveLength(2)
  })
})

describe('a journal that could not be written', () => {
  /**
   * Silence here would be the worst outcome: the build would look complete and
   * the administration would have nothing to show for it.
   */
  it('surfaces the failure instead of losing it', async () => {
    const journal = openJournal(
      storeThat(async () => {
        throw new Error('ENOSPC: no space left on device')
      }),
    )

    journal.record('media', 'started')
    await expect(journal.settled()).rejects.toThrow(/ENOSPC/)
  })
})

describe('progress on its way to the journal', () => {
  it('also reaches the terminal, so a long build is not silent', async () => {
    const echoed: string[] = []
    const written: string[] = []
    const journal = openJournal(storeThat(async (entry) => void written.push(entry.message ?? '')))

    journal.progressOf('radar-rainfall', (message) => echoed.push(message))('  delivery 20044…')
    await journal.settled()

    expect(echoed).toEqual(['  delivery 20044…'])
    expect(written).toEqual(['  delivery 20044…'])
  })
})
