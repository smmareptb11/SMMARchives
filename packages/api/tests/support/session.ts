import type { SessionStore } from '@smmarchives/worker/session/store.ts'

import { hashPassword, parsePasswordHash } from '../../src/password.ts'
import type { Auth } from '../../src/session.ts'

export const PASSWORD = 'correct horse battery staple'

const HASH = parsePasswordHash(await hashPassword(PASSWORD))

/**
 * The real gate, over the sessions given, answering a refusal at once.
 *
 * Kept in memory by default, for an application over a catalogue double; an
 * application over a test database passes the PostgreSQL store.
 */
export function anAuth(sessions: SessionStore = sessionsInMemory()): Auth {
  return {
    passwordHash: HASH,
    sessionSecret: 'a session secret no deployment will ever hold',
    sessions,
    refusalDelayMs: 0,
  }
}

function sessionsInMemory(): SessionStore {
  const held = new Map<string, string>()
  return {
    open: async (digest, expiresAt) => void held.set(digest, expiresAt),
    isOpen: async (digest) => (held.get(digest) ?? '') > new Date().toISOString(),
    close: async (digest) => void held.delete(digest),
  }
}

export function signIn(base: string, password = PASSWORD): Promise<Response> {
  return fetch(`${base}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

/** The `cookie` header a browser sends back once signed in. */
export async function sessionCookie(base: string): Promise<string> {
  const response = await signIn(base)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (response.status !== 204 || cookie === undefined) throw new Error('the sign-in was refused')
  return cookie
}

/** A request as the signed-in administrator sends it. */
export async function asAdmin(base: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('cookie', await sessionCookie(base))
  return fetch(`${base}${path}`, { ...init, headers })
}
