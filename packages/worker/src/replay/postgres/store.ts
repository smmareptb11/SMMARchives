import { Readable } from 'node:stream'

import type { Pool } from 'pg'

import type {
  DatasetName,
  JournalEntry,
  Report,
  ReplayEvent,
  ReplayManifest,
} from '@smmarchives/shared'

import { tx, type Queryable } from '../../db/tx.ts'
import type { ManualEvent, ManualEventChange, ReplayStore, StoredBlob } from '../store.ts'
import {
  deleteManualEvent,
  insertManualEvent,
  readEvent,
  updateManualEvent,
} from './datasets/events.ts'
import { MAPPINGS, type DatasetFilter } from './datasets/index.ts'
import { appendJournal, readJournal } from './journal.ts'
import { readManifest, writeManifest } from './manifest.ts'
import { openMediaDirectory } from './media-directory.ts'

export type PostgresStoreOptions = {
  pool: Pool
  replayId: string
  /** The volume holding the bytes, which the database never holds. */
  mediaRoot: string
}

/**
 * One replay, stored in PostgreSQL, its media on the volume.
 *
 * The write stays generic: a data set's name says its shape, so a lane hands
 * over what it collected and the mapping knows which rows that becomes. Each
 * one lands in a transaction — a run that dies between the clearing and the
 * insert leaves the previous run's rows rather than nothing.
 */
/* eslint-disable-next-line max-lines-per-function -- one object and its methods; the count is the
   port's surface */
export function openPostgresStore(options: PostgresStoreOptions): ReplayStore {
  const { pool, replayId } = options

  return {
    ...openMediaDirectory({ root: options.mediaRoot, replayId }),

    async getManifest(): Promise<ReplayManifest | undefined> {
      return readManifest(pool, replayId)
    },

    async putManifest(manifest: ReplayManifest): Promise<void> {
      // One transaction: the replay, its lanes and its reports are one
      // publication, and a reader must never catch half of one.
      await tx(pool, (db) => writeManifest(db, manifest))
    },

    async appendJournal(entry: JournalEntry): Promise<void> {
      await appendJournal(pool, replayId, entry)
    },

    async readJournal(from: number): Promise<JournalEntry[]> {
      return readJournal(pool, replayId, from)
    },

    async getDataset(name: DatasetName): Promise<unknown> {
      return MAPPINGS[name].read(pool, replayId, {})
    },

    async putDataset(name: DatasetName, data: unknown, report: Report): Promise<void> {
      await tx(pool, async (db) => {
        await MAPPINGS[name].write(db, replayId, data)
        await db.query('update replay set updated_at = now() where id = $1', [replayId])
        // Stamped with the rows it describes, so a reader holding an older
        // copy is told to fetch this one. The report goes in with it: the
        // manifest is read from these lines, and one without its report is a
        // manifest its contract refuses.
        await db.query(
          `insert into replay_dataset (replay_id, name, report, updated_at)
           values ($1, $2, $3::jsonb, now())
           on conflict (replay_id, name) do update
             set report = excluded.report, updated_at = now()`,
          [replayId, name, JSON.stringify(report)],
        )
      })
    },

    async addManualEvent(event: ManualEvent): Promise<ReplayEvent> {
      return tx(pool, async (db) => {
        const id = await insertManualEvent(db, replayId, event)
        await touchEvents(db, replayId)
        return (await readEvent(db, replayId, id))!
      })
    },

    async getManualEvent(id: string): Promise<ReplayEvent | undefined> {
      const event = await readEvent(pool, replayId, id)
      return event?.origin === 'manual' ? event : undefined
    },

    async updateManualEvent(
      id: string,
      event: ManualEvent,
    ): Promise<ManualEventChange | undefined> {
      return tx(pool, async (db) => {
        const previous = await readEvent(db, replayId, id)
        if (previous?.origin !== 'manual') return undefined

        await updateManualEvent(db, replayId, id, event)
        await touchEvents(db, replayId)
        return { previous, current: (await readEvent(db, replayId, id))! }
      })
    },

    async removeManualEvent(id: string): Promise<ReplayEvent | undefined> {
      return tx(pool, async (db) => {
        const previous = await readEvent(db, replayId, id)
        if (previous?.origin !== 'manual') return undefined

        await deleteManualEvent(db, replayId, id)
        await touchEvents(db, replayId)
        return previous
      })
    },

    /**
     * The data set as bytes, serialised from the rows the filter keeps.
     *
     * The version is the moment those rows were last written, and the filter is
     * part of it: two questions over one data set are two answers, and a client
     * holding one must not be told it already has the other.
     */
    async openDataset(
      name: DatasetName,
      filter: DatasetFilter = {},
    ): Promise<StoredBlob | undefined> {
      const stored = await MAPPINGS[name].read(pool, replayId, filter)
      if (stored === undefined) return undefined

      const body = Buffer.from(JSON.stringify(stored))
      const version = (
        await pool.query<{ updated_at: string }>(
          'select updated_at from replay_dataset where replay_id = $1 and name = $2',
          [replayId, name],
        )
      ).rows[0]?.updated_at
      if (version === undefined) return undefined

      const asked = Object.entries(filter)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .sort()
        .join('&')
      return {
        body: Readable.from([body]),
        size: body.byteLength,
        version: `${name}-${version}-${asked}`,
      }
    },
  }
}

/**
 * Moves the version of the events data set, so a reader holding the list from
 * before an agent's change is told to fetch it again.
 */
async function touchEvents(db: Queryable, replayId: string): Promise<void> {
  await db.query('update replay set updated_at = now() where id = $1', [replayId])
  await db.query(
    `update replay_dataset set updated_at = now()
      where replay_id = $1 and name = 'events'`,
    [replayId],
  )
}
