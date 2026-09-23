import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import type { JournalEntry, ReplayManifest } from '@smmarchives/shared'

import { appendJournal, readJournal } from '../src/replay/postgres/journal.ts'
import { writeManifest } from '../src/replay/postgres/manifest.ts'
import { closeDatabase, freshDatabase } from './support/database.ts'

afterAll(closeDatabase)

const at = (second: number) => `2026-09-11T08:00:0${String(second)}.000Z`

function aManifest(): ReplayManifest {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    label: null,
    extent: null,
    period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
    createdAt: at(0),
    updatedAt: at(0),
    state: 'running',
    lanes: {},
    datasets: {},
    media: { copied: 0, skipped: 0, failed: 0, bytes: 0 },
  }
}

describe('the journal of a build', () => {
  let pool: Pool

  beforeEach(async () => {
    pool = await freshDatabase('test_journal')
  })

  /** A replay to hang a journal on, since an entry belongs to one. */
  async function aReplay(): Promise<string> {
    const manifest = aManifest()
    await writeManifest(pool, manifest)
    return manifest.id
  }

  async function journalled(id: string, entries: readonly JournalEntry[]): Promise<void> {
    for (const entry of entries) await appendJournal(pool, id, entry)
  }

  it('keeps every entry, in the order they happened', async () => {
    const id = await aReplay()
    await journalled(id, [
      { at: at(0), lane: 'radar-rainfall', kind: 'started' },
      { at: at(1), lane: 'radar-rainfall', kind: 'progress', message: 'delivery 20044…' },
      { at: at(2), lane: 'radar-rainfall', kind: 'done' },
    ])

    expect((await readJournal(pool, id, 0)).map((entry) => entry.kind)).toEqual([
      'started',
      'progress',
      'done',
    ])
  })

  it('keeps what an entry carries, message included', async () => {
    const id = await aReplay()
    const entry: JournalEntry = { at: at(1), lane: 'media', kind: 'failed', message: 'ENOSPC' }
    await journalled(id, [entry])

    expect(await readJournal(pool, id, 0)).toEqual([entry])
  })

  it('reads back from the line asked for', async () => {
    const id = await aReplay()
    await journalled(id, [
      { at: at(0), lane: 'media', kind: 'started' },
      { at: at(1), lane: 'media', kind: 'progress' },
      { at: at(2), lane: 'media', kind: 'done' },
    ])

    expect((await readJournal(pool, id, 2)).map((entry) => entry.at)).toEqual([at(2)])
  })

  it('numbers the entries of two replays independently', async () => {
    const one = await aReplay()
    const other = await aReplay()
    await journalled(one, [
      { at: at(0), lane: 'media', kind: 'started' },
      { at: at(1), lane: 'media', kind: 'done' },
    ])
    await journalled(other, [{ at: at(2), lane: 'media', kind: 'started' }])

    // Told the way a reader that saw nothing would ask, which is where a shared
    // numbering would show: the second replay would start at line 2 and answer
    // nothing at all.
    expect(await readJournal(pool, other, 0)).toHaveLength(1)
  })

  it('reads back nothing for a build that journalled nothing', async () => {
    expect(await readJournal(pool, await aReplay(), 0)).toEqual([])
  })

  it('goes away with the replay it belongs to', async () => {
    const id = await aReplay()
    await journalled(id, [{ at: at(0), lane: 'media', kind: 'started' }])
    await pool.query('delete from replay where id = $1', [id])

    expect(await readJournal(pool, id, 0)).toEqual([])
  })
})
