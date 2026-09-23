import { rm } from 'node:fs/promises'

import type { Pool } from 'pg'

import type { ReplayIdentity, ReplayManifest } from '@smmarchives/shared'

import type { ReplayCatalog } from '../catalog.ts'
import { CorruptManifestError, type ReplayStore } from '../store.ts'
import { readManifest } from './manifest.ts'
import { mediaDirectoryOf } from './media-directory.ts'
import { openPostgresStore } from './store.ts'

export type PostgresCatalogOptions = {
  pool: Pool
  /** The volume holding the bytes of every replay. */
  mediaRoot: string
  /** Where what a listing cannot show is reported. Silent by default. */
  onProgress?: ((message: string) => void) | undefined
}

/**
 * The replays a database holds.
 *
 * `create` is what the directory catalogue never needed: an identity is minted
 * by what stores it, the way a row's is. No client names a replay, so none can
 * collide with another, and the 409 a taken name used to give disappears.
 */
export type PostgresCatalog = ReplayCatalog & {
  create(identity: Omit<ReplayIdentity, 'id'>): Promise<{ id: string; store: ReplayStore }>
}

/**
 * An identifier this catalogue could have minted.
 *
 * `replayIdSchema` accepts more than that — it guards a route against a name
 * that could address something else — and a replay identifier is now a UUID.
 * Asked for anything else, the catalogue answers that it holds no such replay
 * rather than letting PostgreSQL refuse the value.
 */
const MINTED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/* eslint-disable-next-line max-lines-per-function -- one object and its four methods; the count is
   the port's surface */
export function openPostgresCatalog(options: PostgresCatalogOptions): PostgresCatalog {
  const { pool } = options
  const report = options.onProgress ?? (() => {})
  const storeFor = (id: string) =>
    openPostgresStore({ pool, replayId: id, mediaRoot: options.mediaRoot })

  return {
    /* eslint-disable-next-line complexity -- eight of ten branches are an optional field becoming
       a SQL null; the other two guard the identifier the database mints */
    async create(identity): Promise<{ id: string; store: ReplayStore }> {
      const extent = identity.extent
      const created = await pool.query<{ id: string }>(
        `insert into replay (label, extent, period_from, period_to, created_at, updated_at, state)
         values ($1,
                 case when $2::double precision is null then null
                      else ST_MakeEnvelope($2, $3, $4, $5, 4326) end,
                 $6, $7, now(), now(), 'running')
         returning id`,
        [
          identity.label,
          extent?.minLon ?? null,
          extent?.minLat ?? null,
          extent?.maxLon ?? null,
          extent?.maxLat ?? null,
          identity.period.from,
          identity.period.to,
        ],
      )
      const id = created.rows[0]?.id
      if (id === undefined) throw new Error('the database minted no identifier')
      return { id, store: storeFor(id) }
    },

    async list(): Promise<ReplayManifest[]> {
      // Newest first, decided by the database rather than by the order rows
      // happen to come back in.
      const ids = (
        await pool.query<{ id: string }>('select id from replay order by created_at desc')
      ).rows

      const manifests: ReplayManifest[] = []
      for (const { id } of ids) {
        try {
          const manifest = await readManifest(pool, id)
          if (manifest !== undefined) manifests.push(manifest)
        } catch (error) {
          // A replay nobody can read must not make the others unreadable. It
          // stays reachable by name, where the failure is frank.
          if (!(error instanceof CorruptManifestError)) throw error
          report(`${error.message}, and it is left out of the listing`)
        }
      }
      return manifests
    },

    async open(id: string): Promise<ReplayStore | undefined> {
      if (!MINTED.test(id)) return undefined
      const found = await pool.query('select 1 from replay where id = $1', [id])
      return found.rowCount === 0 ? undefined : storeFor(id)
    },

    async remove(id: string): Promise<boolean> {
      if (!MINTED.test(id)) return false

      // The rows first, the bytes after: a replay gone from the database stops
      // being listed at once, and what is left on the volume is orphaned bytes
      // nothing points at. The other order would leave a replay that lists
      // itself and whose images have vanished.
      const removed = await pool.query('delete from replay where id = $1', [id])
      if (removed.rowCount === 0) return false

      await rm(mediaDirectoryOf(options.mediaRoot, id), { recursive: true, force: true }).catch(
        (error: unknown) => {
          // Reported rather than raised: the replay is gone either way, and
          // answering failure would send a caller looking for it.
          report(`removing ${id} left its media behind: ${String(error)}`)
        },
      )
      return true
    },
  }
}
