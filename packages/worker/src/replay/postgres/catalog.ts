import { rm } from 'node:fs/promises'

import type { Pool } from 'pg'

import type { ReplayAbout, ReplayIdentity, ReplayManifest } from '@smmarchives/shared'

import { isReplayId, type ReplayCatalog } from '../catalog.ts'
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
 * `create` mints an identity in what stores it, the way a row's is. No client
 * names a replay, so none can collide with another, and none has to be refused.
 */
export type PostgresCatalog = ReplayCatalog & {
  create(
    identity: Omit<ReplayIdentity, 'id'>,
    about?: ReplayAbout,
  ): Promise<{ id: string; store: ReplayStore }>
}

/* eslint-disable-next-line max-lines-per-function -- one object and its four methods; the count is
   the port's surface */
export function openPostgresCatalog(options: PostgresCatalogOptions): PostgresCatalog {
  const { pool } = options
  const report = options.onProgress ?? (() => {})
  const storeFor = (id: string) =>
    openPostgresStore({ pool, replayId: id, mediaRoot: options.mediaRoot })

  return {
    /* eslint-disable-next-line complexity -- nine of eleven branches are an optional field becoming
       a SQL null; the other two guard the identifier the database mints */
    async create(identity, about = {}): Promise<{ id: string; store: ReplayStore }> {
      const extent = identity.extent
      const created = await pool.query<{ id: string }>(
        `insert into replay (label, extent, territory, period_from, period_to, created_at,
                             updated_at, state, description, phenomenon, severity)
         values ($1,
                 case when $2::double precision is null then null
                      else ST_MakeEnvelope($2, $3, $4, $5, 4326) end,
                 $6, $7, $8, now(), now(), 'running', $9, $10, $11)
         returning id`,
        [
          identity.label,
          extent?.minLon ?? null,
          extent?.minLat ?? null,
          extent?.maxLon ?? null,
          extent?.maxLat ?? null,
          identity.territory ?? null,
          identity.period.from,
          identity.period.to,
          about.description ?? null,
          about.phenomenon ?? null,
          about.severity ?? null,
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

      // Side by side rather than one after the other: the pool bounds how many
      // run at once, and the listing keeps the order of the identifiers.
      const manifests = await Promise.all(
        ids.map(async ({ id }) => {
          try {
            return await readManifest(pool, id)
          } catch (error) {
            // A replay nobody can read must not make the others unreadable. It
            // stays reachable by name, where the failure is frank.
            if (!(error instanceof CorruptManifestError)) throw error
            report(`${error.message}, and it is left out of the listing`)
            return undefined
          }
        }),
      )
      return manifests.filter((manifest) => manifest !== undefined)
    },

    async open(id: string): Promise<ReplayStore | undefined> {
      if (!isReplayId(id)) return undefined
      const found = await pool.query('select 1 from replay where id = $1', [id])
      return found.rowCount === 0 ? undefined : storeFor(id)
    },

    async remove(id: string): Promise<boolean> {
      if (!isReplayId(id)) return false

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
