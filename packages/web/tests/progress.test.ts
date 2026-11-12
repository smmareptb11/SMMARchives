import { describe, expect, it } from 'vitest'

import type { JournalEntry, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import {
  EMPTY,
  JOURNAL_KEPT,
  isAtEnd,
  readThenFollow,
  reduceProgress,
  type StreamEvent,
} from '../src/build/progress.ts'

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
  media: { copied: 0, failed: 0, bytes: 0 },
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

describe('whether the reader is on the last line of the journal', () => {
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 288 })

  it('is, at the bottom of the box', () => {
    expect(isAtEnd(box(712))).toBe(true)
  })

  /** A high-density screen scrolls by fractions, and seldom lands on the exact pixel. */
  it('is, a pixel or two short of the bottom', () => {
    expect(isAtEnd(box(709.5))).toBe(true)
  })

  it('is not, once scrolled up to read', () => {
    expect(isAtEnd(box(500))).toBe(false)
  })

  it('is, on a journal too short to scroll', () => {
    expect(isAtEnd({ scrollTop: 0, scrollHeight: 120, clientHeight: 120 })).toBe(true)
  })
})

describe('a replay read, then its build followed', () => {
  /** A read the test answers when it chooses. */
  function pending() {
    let answer: (manifest: ReplayManifest) => void = () => {}
    const read = () => new Promise<ReplayManifest>((settle) => (answer = settle))
    return { read, answer: (one: ReplayManifest) => answer(one) }
  }

  it('follows a build under way once the replay is read, and stops following when left', async () => {
    const { read, answer } = pending()
    let following = 0
    const stop = readThenFollow(read, () => ((following += 1), () => (following -= 1)), {
      read: () => {},
      failed: () => {},
    })

    answer(manifest)
    await Promise.resolve()
    expect(following).toBe(1)
    stop()
    expect(following).toBe(0)
  })

  it('follows nothing when left before the replay came back', async () => {
    const { read, answer } = pending()
    let followed = false
    let shown = false
    const stop = readThenFollow(read, () => ((followed = true), () => {}), {
      read: () => (shown = true),
      failed: () => {},
    })

    stop()
    answer(manifest)
    await Promise.resolve()
    expect(followed).toBe(false)
    expect(shown).toBe(false)
  })

  it('follows nothing for a build that is over', async () => {
    const { read, answer } = pending()
    let followed = false
    readThenFollow(read, () => ((followed = true), () => {}), { read: () => {}, failed: () => {} })

    answer({ ...manifest, state: 'complete' })
    await Promise.resolve()
    expect(followed).toBe(false)
  })
})
