import { describe, expect, it } from 'vitest'

import type { JournalEntry, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { EMPTY, JOURNAL_KEPT, reduceProgress, type StreamEvent } from '../src/build/progress.ts'

const manifest = {
  schemaVersion: 1,
  id: 'c4a7c5be-73d0-48db-aa17-8be7b314f863',
  label: null,
  extent: null,
  period: { from: '2019-10-22T04:00:00.000Z', to: '2019-10-23T04:00:00.000Z' },
  createdAt: '2026-09-12T08:00:00.000Z',
  updatedAt: '2026-09-12T08:00:00.000Z',
  state: 'running',
  lanes: { aquasys: { state: 'running' } },
  datasets: {},
  media: { copied: 0, skipped: 0, failed: 0, bytes: 0 },
} satisfies ReplayManifest

const entry = (kind: JournalEntry['kind'], at = '2026-09-12T08:00:00.000Z'): StreamEvent => ({
  event: 'journal',
  data: { at, lane: 'aquasys', kind },
})

describe('what a progress stream leaves on screen', () => {
  it('keeps the last manifest, not the first', () => {
    const published: StreamEvent[] = [
      { event: 'manifest', data: manifest },
      { event: 'manifest', data: { ...manifest, state: 'partial' } },
    ]
    const state = published.reduce(reduceProgress, EMPTY)

    expect(state.manifest?.state).toBe('partial')
  })

  it('keeps the journal in the order it arrived', () => {
    const state = [entry('started'), entry('done')].reduce(reduceProgress, EMPTY)

    expect(state.journal.map((one) => one.kind)).toEqual(['started', 'done'])
  })

  it('is over once the build says so', () => {
    const state = reduceProgress(EMPTY, { event: 'end', data: { state: 'complete' } })

    expect(state.ended).toBe('complete')
  })

  it('holds a journal long enough to read, and no longer', () => {
    // A build of three days writes thousands of lines. The screen shows the
    // tail; the whole trace stays one route away, at `/replays/:id/journal`.
    const many = Array.from({ length: JOURNAL_KEPT + 100 }, (_, index) =>
      entry('progress', `2026-09-12T08:00:${String(index % 60).padStart(2, '0')}.000Z`),
    )
    const state = many.reduce(reduceProgress, EMPTY)

    expect(state.journal).toHaveLength(JOURNAL_KEPT)
    expect(state.journal[0]).toEqual(many[100]?.data)
  })

  it('leaves an event it cannot read alone, rather than emptying the screen', () => {
    const state = reduceProgress(
      { ...EMPTY, manifest },
      { event: 'manifest', data: 'not a manifest' },
    )

    expect(state.manifest).toEqual(manifest)
  })
})
