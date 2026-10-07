import { parseArgs } from 'node:util'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { ReplayIdentity, ReplayManifest } from '@smmarchives/shared'

import { buildArguments, type BuildLauncher } from '../src/builds.ts'
import {
  aManifest,
  anApi,
  appOn,
  cleanRoots,
  closeDatabase,
  NEVER_ENDS,
  post,
  writeReplay,
  type Api,
  type Problem,
} from './support/replay.ts'
import { withServer } from './support/server.ts'

afterEach(cleanRoots)
afterAll(closeDatabase)

const body = {
  label: "Crue de l'Aude, octobre 2019",
  period: { from: '2019-10-22T00:00:00Z', to: '2019-10-23T00:00:00Z' },
}

/** A byte a command line cannot carry, kept out of this file's own source. */
const NUL = String.fromCharCode(0)

/** A build that publishes its manifest, which is a real one's first act. */
function publishing(api: Api): BuildLauncher {
  return (identity) => ({
    exited: (async () => {
      await writeReplay(api, aManifest({ id: identity.id, state: 'running' }))
      return NEVER_ENDS
    })(),
  })
}

/** A build that refused its arguments or its environment, as the CLI does. */
const refusing: BuildLauncher = () => ({
  exited: Promise.resolve({
    code: 1,
    stderr: 'ACYCLIQ_TOKEN: is required and empty. See .env.sample.\n',
  }),
})

/** Wraps a launcher to keep what it was handed. */
function recorded(inner: BuildLauncher): { asked: ReplayIdentity[]; launch: BuildLauncher } {
  const asked: ReplayIdentity[] = []
  return {
    asked,
    launch: (identity) => {
      asked.push(identity)
      return inner(identity)
    },
  }
}

describe('creating a replay', () => {
  it('answers with the manifest of the replay it minted', async () => {
    const api = await anApi()

    await withServer(appOn(api, { publishTimeout: 20 }), async (base) => {
      const response = await post(base, body)

      expect(response.status).toBe(201)
      const manifest = (await response.json()) as ReplayManifest
      expect(manifest.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(response.headers.get('location')).toBe(`/replays/${manifest.id}`)
      expect(manifest.label).toBe(body.label)
      expect(manifest.period.from).toBe('2019-10-22T00:00:00.000Z')
    })
  })

  it('mints a different identifier for every creation', async () => {
    const api = await anApi()

    await withServer(appOn(api, { publishTimeout: 20 }), async (base) => {
      const one = (await (await post(base, body)).json()) as ReplayManifest
      const other = (await (await post(base, body)).json()) as ReplayManifest

      // Two replays of the same period and the same label are two replays.
      expect(one.id).not.toBe(other.id)
      expect(await api.catalog.list()).toHaveLength(2)
    })
  })

  it('hands the build the replay it minted, and what was asked of it', async () => {
    const api = await anApi()
    const { asked, launch } = recorded(publishing(api))

    await withServer(appOn(api, { launch, publishTimeout: 20 }), async (base) => {
      const response = await post(base, {
        ...body,
        extent: { minLon: 2, minLat: 42.7, maxLon: 3.2, maxLat: 43.4 },
      })
      const manifest = (await response.json()) as ReplayManifest

      expect(asked).toEqual([
        {
          id: manifest.id,
          label: body.label,
          extent: { minLon: 2, minLat: 42.7, maxLon: 3.2, maxLat: 43.4 },
          period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
        },
      ])
    })
  })

  it('answers while the build is still running, since the replay already exists', async () => {
    const api = await anApi()

    await withServer(appOn(api, { publishTimeout: 20 }), async (base) => {
      const manifest = (await (await post(base, body)).json()) as ReplayManifest

      expect(manifest.state).toBe('running')
      expect(manifest.datasets).toEqual({})
    })
  })

  it('answers with what the build published, when it published before the wait was over', async () => {
    const api = await anApi()
    const launch: BuildLauncher = (identity) => ({
      exited: (async () => {
        await writeReplay(api, aManifest({ id: identity.id, state: 'complete', label: body.label }))
        return { code: 0, stderr: '' }
      })(),
    })

    await withServer(appOn(api, { launch, publishTimeout: 200 }), async (base) => {
      const manifest = (await (await post(base, body)).json()) as ReplayManifest

      expect(manifest.state).toBe('complete')
    })
  })
})

describe('a build that refused to start', () => {
  it('is the server failing, not the request being wrong', async () => {
    const api = await anApi()

    await withServer(appOn(api, { launch: refusing, publishTimeout: 200 }), async (base) => {
      const response = await post(base, body)

      expect(response.status).toBe(500)
      expect((await response.json()) as Problem).toMatchObject({ type: 'internal' })
    })
  })

  it('says why in the log, and only there', async () => {
    const api = await anApi()
    const said: string[] = []

    const app = appOn(api, { launch: refusing, publishTimeout: 200, log: (m) => said.push(m) })
    await withServer(app, async (base) => {
      const response = await post(base, body)
      expect(JSON.stringify(await response.json())).not.toContain('ACYCLIQ_TOKEN')
    })
    expect(said.join('\n')).toContain('ACYCLIQ_TOKEN')
  })

  it('leaves no replay behind, since nothing was ever collected into it', async () => {
    const api = await anApi()

    await withServer(appOn(api, { launch: refusing, publishTimeout: 200 }), async (base) => {
      expect((await post(base, body)).status).toBe(500)
      expect(await (await fetch(`${base}/replays`)).json()).toEqual([])
    })
  })
})

describe('refusing a creation', () => {
  it('refuses a period that ends before it starts', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await post(base, {
        ...body,
        period: { from: '2019-10-23T00:00:00Z', to: '2019-10-22T00:00:00Z' },
      })
      expect(response.status).toBe(400)
      expect((await response.json()) as Problem & { refusals: { path: string }[] }).toMatchObject({
        refusals: [{ path: 'period', message: 'must be two instants, in order' }],
      })
    })
  })

  it.each([
    ['no period', { label: null }, 'period'],
    ['an instant that is not one', { ...body, period: { from: 'x', to: 'y' } }, 'period'],
    [
      'a period reversed by a fraction of a second',
      { ...body, period: { from: '2019-10-22T00:00:00.500Z', to: '2019-10-22T00:00:00Z' } },
      'period',
    ],
    [
      'an extent off the Earth',
      { ...body, extent: { minLon: 0, minLat: 0, maxLon: 1000, maxLat: 1 } },
      'extent.maxLon',
    ],
    [
      'an extent reaching past the territory',
      { ...body, extent: { minLon: 2, minLat: 42.7, maxLon: 3.2, maxLat: 43.7 } },
      'extent',
    ],
    [
      'an extent outside the territory',
      { ...body, extent: { minLon: 5.3, minLat: 43.2, maxLon: 5.5, maxLat: 43.4 } },
      'extent',
    ],
    ['a label longer than a title', { ...body, label: 'x'.repeat(201) }, 'label'],
  ])('refuses %s', async (_case, payload, path) => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await post(base, payload)
      expect(response.status).toBe(400)
      const problem = (await response.json()) as Problem & { refusals: { path: string }[] }
      expect(problem.refusals.map((one) => one.path)).toContain(path)
      // Whatever was sent, none of it comes back.
      expect(JSON.stringify(problem)).not.toContain(JSON.stringify(payload).slice(1, 20))
    })
  })

  it('refuses a label carrying a byte a command line cannot', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await post(base, { ...body, label: `a${NUL}b` })

      expect(response.status).toBe(400)
      const problem = (await response.json()) as Problem & { refusals: { path: string }[] }
      expect(problem.refusals.map((one) => one.path)).toContain('label')
    })
  })

  it('refuses an identifier a client tries to choose', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await post(base, { ...body, id: 'aude-2019-10' })

      // Told rather than ignored: a client that believed it named its replay
      // would keep addressing one that does not exist.
      expect(response.status).toBe(400)
      const problem = (await response.json()) as Problem & { refusals: { path: string }[] }
      expect(problem.refusals.map((one) => one.path)).toContain('id')
      expect(await (await fetch(`${base}/replays`)).json()).toEqual([])
    })
  })

  it('names the field it refused, never the value it was sent', async () => {
    const api = await anApi()

    await withServer(appOn(api), async (base) => {
      const response = await post(base, { ...body, label: `SECRET${NUL}VALUE` })
      const problem = (await response.json()) as Problem & { refusals: unknown }
      expect(problem.refusals).toEqual([
        { path: 'label', message: 'must not carry control characters' },
      ])
      expect(JSON.stringify(problem)).not.toContain('SECRET')
    })
  })

  it('refuses a body that is not JSON, as a request rather than a failure', async () => {
    const api = await anApi()
    const said: string[] = []

    await withServer(appOn(api, { log: (m) => said.push(m) }), async (base) => {
      const response = await fetch(`${base}/replays`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      })
      expect(response.status).toBe(400)
    })
    // A malformed request is not the server failing, and does not deserve a
    // stack per attempt.
    expect(said).toEqual([])
  })

  it('never starts a build, nor mints a replay, for a request it refused', async () => {
    const api = await anApi()
    const { asked, launch } = recorded(publishing(api))

    await withServer(appOn(api, { launch }), async (base) => {
      await post(base, { ...body, period: { from: 'x', to: 'y' } })

      expect(asked).toEqual([])
      expect(await (await fetch(`${base}/replays`)).json()).toEqual([])
    })
  })
})

describe('the arguments a build is given', () => {
  it('names the replay, its period, its label and its extent', () => {
    expect(
      buildArguments({
        id: 'aude-2019-10',
        label: "Crue de l'Aude",
        extent: { minLon: 2, minLat: 42.7, maxLon: 3.2, maxLat: 43.6 },
        period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
      }),
    ).toEqual([
      '--id=aude-2019-10',
      '--from=2019-10-22T00:00:00.000Z',
      '--to=2019-10-23T00:00:00.000Z',
      "--label=Crue de l'Aude",
      // The order `parseBoundingBox` reads, not the order the object declares.
      '--bbox=2,42.7,3.2,43.6',
    ])
  })

  it('keeps a value that starts with a dash reachable', () => {
    const args = buildArguments({
      id: 'ouest',
      label: '-9 to 3',
      extent: { minLon: -9.97, minLat: 39.46, maxLon: 14.55, maxLat: 54.18 },
      period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
    })

    // `parseArgs` runs strict and calls `--bbox -9.97,…` ambiguous, so an
    // extent west of Greenwich would fail every build the API accepts.
    expect(args).toContain('--bbox=-9.97,39.46,14.55,54.18')
    expect(args).toContain('--label=-9 to 3')
    // Read back the way the CLI reads them — strict, which is what refuses a
    // dash-leading value written as two words.
    const options = {
      id: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      label: { type: 'string' },
      bbox: { type: 'string' },
    } as const
    expect(
      parseArgs({ args, options, strict: true, allowPositionals: false }).values,
    ).toMatchObject({ bbox: '-9.97,39.46,14.55,54.18', label: '-9 to 3' })
  })

  it('leaves out what was not given, rather than passing an empty flag', () => {
    expect(
      buildArguments({
        id: 'aude-2019-10',
        label: null,
        extent: null,
        period: { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' },
      }),
    ).toEqual([
      '--id=aude-2019-10',
      '--from=2019-10-22T00:00:00.000Z',
      '--to=2019-10-23T00:00:00.000Z',
    ])
  })
})
