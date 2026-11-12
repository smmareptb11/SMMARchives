import type { Pool } from 'pg'

import type { SessionStore } from './store.ts'

export function openPostgresSessionStore(pool: Pool): SessionStore {
  return {
    async open(digest, expiresAt) {
      await pool.query('delete from session where expires_at <= now()')
      await pool.query('insert into session (digest, expires_at) values ($1, $2)', [
        digest,
        expiresAt,
      ])
    },

    async isOpen(digest) {
      const found = await pool.query(
        'select 1 from session where digest = $1 and expires_at > now()',
        [digest],
      )
      return found.rowCount !== 0
    },

    async close(digest) {
      await pool.query('delete from session where digest = $1', [digest])
    },
  }
}
