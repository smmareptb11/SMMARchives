import { Readable } from 'node:stream'

import type { Pool } from 'pg'

import type { DatasetName, JournalEntry, Report, ReplayManifest } from '@smmarchives/shared'

import { tx } from '../../db/tx.ts'
import type { ReplayStore, StoredBlob } from '../store.ts'
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
