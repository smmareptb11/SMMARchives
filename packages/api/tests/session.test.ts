import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { openPostgresSessionStore } from '@smmarchives/worker/session/postgres.ts'

import {
  aManifest,
  anApi,
  appOn,
  cleanRoots,
  closeDatabase,
  writeReplay,
  type Problem,
} from './support/replay.ts'
import { withServer } from './support/server.ts'
import { PASSWORD, anAuth, sessionCookie, signIn } from './support/session.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

async function signedIn(base: string, cookie?: string): Promise<boolean> {
  const response = await fetch(
    `${base}/session`,
    cookie === undefined ? {} : { headers: { cookie } },
  )
  return ((await response.json()) as { authenticated: boolean }).authenticated
}

describe('signing in', () => {
  it('hands back a cookie no script can read and no other site can send', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await signIn(base)
      expect(response.status).toBe(204)

      const cookie = response.headers.get('set-cookie') ?? ''
      expect(cookie).toMatch(/^smmarchives_session=[\w-]{43};/)
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Strict')
      expect(cookie).toMatch(/Expires=/)
    })
  })

  it('opens a session the next request is recognised by', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      expect(await signedIn(base)).toBe(false)
      expect(await signedIn(base, await sessionCookie(base))).toBe(true)
    })
  })

  it('stores the digest of the token, never the token', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const token = (await sessionCookie(base)).split('=')[1]
      const stored = await api.pool.query<{ digest: string }>('select digest from session')
      expect(stored.rows).toHaveLength(1)
      expect(stored.rows[0]?.digest).not.toContain(token)
    })
  })

  it('refuses a wrong password, and opens nothing', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await signIn(base, 'not the password')
      expect(response.status).toBe(401)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect((await response.json()) as Problem).toMatchObject({ type: 'unauthorized' })
    })
    expect((await api.pool.query('select 1 from session')).rowCount).toBe(0)
  })

  it('makes a wrong password wait before it is answered', async () => {
    const api = await anApi()
    const auth = { ...anAuth(openPostgresSessionStore(api.pool)), refusalDelayMs: 200 }

    await withServer(appOn(api, { auth }), async (base) => {
      const started = performance.now()
      expect((await signIn(base, 'not the password')).status).toBe(401)
      expect(performance.now() - started).toBeGreaterThanOrEqual(190)
    })
  })

  it('makes wrong passwords sent side by side wait one after the other', async () => {
    const api = await anApi()
    const auth = { ...anAuth(openPostgresSessionStore(api.pool)), refusalDelayMs: 100 }

    await withServer(appOn(api, { auth }), async (base) => {
      const started = performance.now()
      const refused = await Promise.all([1, 2, 3, 4].map(() => signIn(base, 'not the password')))
      expect(refused.map((response) => response.status)).toEqual([401, 401, 401, 401])
      expect(performance.now() - started).toBeGreaterThanOrEqual(390)
    })
  })

  it('still lets the right password in behind wrong ones', async () => {
    const api = await anApi()
    const auth = { ...anAuth(openPostgresSessionStore(api.pool)), refusalDelayMs: 50 }

    await withServer(appOn(api, { auth }), async (base) => {
      const [wrong, right] = await Promise.all([signIn(base, 'not the password'), signIn(base)])
      expect(wrong.status).toBe(401)
      expect(right.status).toBe(204)
    })
  })

  it('refuses a body that carries no password, as a request', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pass: 'x' }),
      })
      expect(response.status).toBe(400)
    })
  })

  it('marks the cookie Secure when the reverse proxy says the request came over HTTPS', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
        body: JSON.stringify({ password: PASSWORD }),
      })
      expect(response.headers.get('set-cookie')).toContain('Secure')
      expect((await signIn(base)).headers.get('set-cookie')).not.toContain('Secure')
    })
  })

  it('leaves the cookie as it is when the request comes from a proxy it was not told to trust', async () => {
    const api = await anApi()

    await withServer(appOn(api, { trustedProxy: '10.0.0.0/8' }), async (base) => {
      const response = await fetch(`${base}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
        body: JSON.stringify({ password: PASSWORD }),
      })
      expect(response.headers.get('set-cookie')).not.toContain('Secure')
    })
  })
})

describe('a session', () => {
  it('ends when the administrator signs out, whoever kept the cookie', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const cookie = await sessionCookie(base)
      const out = await fetch(`${base}/session`, { method: 'DELETE', headers: { cookie } })
      expect(out.status).toBe(204)
      expect(out.headers.get('set-cookie')).toMatch(/^smmarchives_session=;/)

      expect(await signedIn(base, cookie)).toBe(false)
    })
  })

  it('ends on its own once expired', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const cookie = await sessionCookie(base)
      await api.pool.query(`update session set expires_at = now() - interval '1 second'`)
      expect(await signedIn(base, cookie)).toBe(false)
    })
  })

  it('is not opened by a token the API never handed out', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      expect(await signedIn(base, `smmarchives_session=${'a'.repeat(43)}`)).toBe(false)
    })
  })

  it('is not opened under another secret', async () => {
    const api = await anApi()
    const sessions = openPostgresSessionStore(api.pool)
    const cookie = await withServer(appOn(api), sessionCookie)
    const other = { ...anAuth(sessions), sessionSecret: 'another secret, after a rotation' }

    await withServer(appOn(api, { auth: other }), async (base) => {
      expect(await signedIn(base, cookie)).toBe(false)
    })
  })
})

type Routed = { router: { stack: Array<{ route?: { path: string; methods: object } }> } }

/**
 * Every route the application declares that changes something, read from its
 * router rather than written down: a list kept by hand here would miss the
 * route its twin in the application missed.
 */
function changingRoutes(app: unknown): Array<[string, string]> {
  return (app as Routed).router.stack.flatMap(({ route }) =>
    route === undefined || route.path === '/session'
      ? []
      : Object.keys(route.methods)
          .map((method) => method.toUpperCase())
          .filter((method) => !['GET', 'HEAD', 'OPTIONS', '_ALL'].includes(method))
          .map((method): [string, string] => [method, route.path]),
  )
}

describe('a route that changes something', () => {
  const PERIOD = { from: '2019-10-22T00:00:00Z', to: '2019-10-23T00:00:00Z' }

  it('turns away a stranger, every one of them, and leaves the replay as it was', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)
    const app = appOn(api)
    const routes = changingRoutes(app)
    expect(routes.length).toBeGreaterThanOrEqual(7)

    await withServer(app, async (base) => {
      for (const [method, path] of routes) {
        const concrete = path.replace(':id', manifest.id).replace(/:\w+/g, 'an-event')
        const response = await fetch(`${base}${concrete}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: null, period: PERIOD }),
        })
        expect(response.status, `${method} ${path}`).toBe(401)
        expect((await response.json()) as Problem).toMatchObject({ type: 'unauthorized' })
      }
    })
    expect((await api.catalog.list()).map((one) => one.id)).toEqual([manifest.id])
  })

  it('answers a stranger the same whether the replay exists or not', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/replays/${crypto.randomUUID()}`, { method: 'DELETE' })
      expect(response.status).toBe(401)
    })
  })

  it('lets the signed-in administrator through', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)

    await withServer(appOn(api), async (base) => {
      const cookie = await sessionCookie(base)
      const response = await fetch(`${base}/replays/${manifest.id}`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(response.status).toBe(204)
    })
  })
})

/** A sibling subdomain is the same site, so the strict cookie travels with its forms. */
describe('a change another site asks for', () => {
  it.each(['same-site', 'cross-site'])(
    'is refused when the browser says it comes from %s, signed in or not',
    async (from) => {
      const api = await anApi()
      const manifest = aManifest()
      await writeReplay(api, manifest)

      await withServer(appOn(api), async (base) => {
        const cookie = await sessionCookie(base)
        const response = await fetch(`${base}/replays/${manifest.id}`, {
          method: 'DELETE',
          headers: { cookie, 'sec-fetch-site': from },
        })
        expect(response.status).toBe(403)
        expect((await response.json()) as Problem).toMatchObject({ type: 'forbidden' })
      })
      expect((await api.catalog.list()).map((one) => one.id)).toEqual([manifest.id])
    },
  )

  it('is refused for signing in too', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' },
        body: JSON.stringify({ password: PASSWORD }),
      })
      expect(response.status).toBe(403)
    })
  })

  it('goes through from the application itself', async () => {
    const api = await anApi()
    const manifest = aManifest()
    await writeReplay(api, manifest)

    await withServer(appOn(api), async (base) => {
      const cookie = await sessionCookie(base)
      const response = await fetch(`${base}/replays/${manifest.id}`, {
        method: 'DELETE',
        headers: { cookie, 'sec-fetch-site': 'same-origin' },
      })
      expect(response.status).not.toBe(403)
    })
  })

  it('leaves a reading alone, wherever it comes from', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/session`, {
        headers: { 'sec-fetch-site': 'cross-site' },
      })
      expect(response.status).toBe(200)
    })
  })
})

describe('a body heavier than its route takes', () => {
  it('is refused as too large, and says so in its type', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await fetch(`${base}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'x'.repeat(10_000) }),
      })
      expect(response.status).toBe(413)
      expect((await response.json()) as Problem).toMatchObject({ type: 'content-too-large' })
    })
  })
})
