import { createHmac, randomBytes } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import express, { type Express, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'

import type { SessionStore } from '@smmarchives/worker/session/store.ts'

import { verifyPassword, type PasswordHash } from './password.ts'
import { badRequest, forbidden, refusalsIn, unauthorized } from './problems.ts'

export type Auth = {
  passwordHash: PasswordHash
  sessionSecret: string
  sessions: SessionStore
  /** How long a refused password waits before it is answered. Shortened in tests. */
  refusalDelayMs?: number | undefined
}

const SESSION_COOKIE = 'smmarchives_session'
const ADMIN = 'admin'

/** A working day, and the evening of a flood. */
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000
const TOKEN_BYTES = 32
const TOKEN_SHAPE = /^[\w-]{43}$/

const signInSchema = z.strictObject({ password: z.string().min(1).max(1024) })

export function registerSession(app: Express, auth: Auth): void {
  const attempt = oneAtATime()

  app.get('/session', (_req, res) => {
    res.json({ authenticated: isAdmin(res) })
  })

  app.post('/session', express.json({ limit: '4kb' }), async (req, res) => {
    const parsed = signInSchema.safeParse(req.body)
    if (!parsed.success) {
      badRequest(res, 'a password is expected', refusalsIn(parsed.error))
      return
    }
    const accepted = await attempt(async () => {
      if (await verifyPassword(parsed.data.password, auth.passwordHash)) return true
      await sleep(auth.refusalDelayMs ?? 1_000)
      return false
    })
    if (!accepted) {
      unauthorized(res, 'this password opens nothing')
      return
    }

    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)
    await auth.sessions.open(digestOf(auth, token), expiresAt.toISOString())
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), expires: expiresAt })
    res.status(204).end()
  })

  app.delete('/session', async (req, res) => {
    const token = tokenOf(req)
    if (token !== undefined) await auth.sessions.close(digestOf(auth, token))
    res.clearCookie(SESSION_COOKIE, cookieOptions(req))
    res.status(204).end()
  })
}

/**
 * Runs the attempts to sign in one after the other, so a refusal's wait holds
 * back every attempt behind it, and parallel ones cannot fill with scrypt the
 * thread pool the rest of the API reads files on.
 */
function oneAtATime(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve()
  return (task) => {
    const next = last.then(task, task)
    last = next.catch(() => {})
    return next
  }
}

/**
 * Reads the session once, ahead of every route, for each of them to ask
 * {@link isAdmin} rather than the store.
 */
export function recogniseAdmin(auth: Auth): RequestHandler {
  return async (req, res, next) => {
    res.locals[ADMIN] = await isSignedIn(auth, req)
    next()
  }
}

export function isAdmin(res: Response): boolean {
  return res.locals[ADMIN] === true
}

/** The methods that read, and change nothing. */
const READING = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Every request that changes something needs the administrator, so a route
 * added later is closed until it is opened. Before the routes' own checks, so
 * nothing about the replay is said to a stranger.
 */
export const requireAdminToChange: RequestHandler = (req, res, next) => {
  if (READING.has(req.method) || isAdmin(res)) next()
  else unauthorized(res, 'sign in to change anything')
}

/**
 * Turns away a change another origin asked for. `SameSite=Strict` lets through
 * a sibling subdomain, which is the same *site*. A client that is not a browser
 * sends no `Sec-Fetch-Site`, and holds no cookie another site could lend it.
 */
export const refuseOtherSites: RequestHandler = (req, res, next) => {
  const from = req.get('sec-fetch-site')
  if (READING.has(req.method) || from === undefined || from === 'same-origin') next()
  else forbidden(res, 'a change is accepted from this application only')
}

async function isSignedIn(auth: Auth, req: Request): Promise<boolean> {
  const token = tokenOf(req)
  return token !== undefined && (await auth.sessions.isOpen(digestOf(auth, token)))
}

/**
 * `Strict` keeps the cookie off every request another site starts, which is
 * the whole defence against a forged write. `Secure` follows the request: the
 * reverse proxy says HTTPS, the development server does not.
 */
function cookieOptions(req: Request) {
  return { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' } as const
}

function digestOf(auth: Auth, token: string): string {
  return createHmac('sha256', auth.sessionSecret).update(token).digest('hex')
}

function tokenOf(req: Request): string | undefined {
  for (const pair of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = pair.trim().split('=', 2)
    if (name === SESSION_COOKIE && value !== undefined && TOKEN_SHAPE.test(value)) return value
  }
  return undefined
}
