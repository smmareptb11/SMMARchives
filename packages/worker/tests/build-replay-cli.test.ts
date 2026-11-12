import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDatabase, freshDatabase, urlPinnedTo } from './support/database.ts'

const CHECKOUT = fileURLToPath(new URL('../../..', import.meta.url))
const RUNNER = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../src/scripts/build-replay.ts', import.meta.url))
const SCHEMA = 'test_build_replay_cli'

/**
 * Enough to open a database and not enough to collect anything: the build
 * stops on the first configuration it needs and does not have.
 *
 * Every source variable is blanked rather than inherited, so the developer's
 * own environment cannot decide what these runs find configured.
 */
function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: urlPinnedTo(SCHEMA),
    MEDIA_PATH: '/tmp/smmarchives-cli-test',
    RADAR_RAINFALL_PATH: '',
    ACYCLIQ_API_URL: '',
    ACYCLIQ_TOKEN: '',
    LIZMAP_BASE_URL: '',
    ...extra,
  }
}

function run(
  extra: NodeJS.ProcessEnv = {},
  flags: string[] = [],
  { readerLeaves = false } = {},
): Promise<{ code: number | null; took: number; stderr: string }> {
  const started = Date.now()
  const child = spawn(
    RUNNER,
    [SCRIPT, '--from=2019-10-22T00:00:00Z', '--to=2019-10-23T00:00:00Z', ...flags],
    { cwd: CHECKOUT, env: environment(extra), stdio: ['ignore', 'ignore', 'pipe'] },
  )

  let stderr = ''
  if (readerLeaves) child.stderr.destroy()
  else child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
  return new Promise((settle) => {
    child.once('close', (code) => settle({ code, took: Date.now() - started, stderr }))
  })
}

let pool: Pool

beforeAll(async () => {
  pool = await freshDatabase(SCHEMA)
})

afterAll(closeDatabase)

async function replays(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>('select count(*) as count from replay')
  return rows[0]?.count ?? 0
}

/**
 * The API spawns this command and waits a few seconds to hear whether it could
 * start at all. A build that lingers past that window is reported as running,
 * and the replay it never filled says so for ever.
 */
describe('the build command as the API spawns it', () => {
  it('gives its exit code back instead of holding the process open', async () => {
    const { code, took, stderr } = await run()

    // Which variable it names depends on the order the lanes are configured;
    // that it stopped on one of them is the point. Not the radar root, which
    // stops nothing.
    expect(stderr).toMatch(/ConfigurationError/)
    expect(code).toBe(1)
    // Well under the ten seconds an idle connection pool would have held it:
    // that pool is what this asserts the command closes.
    expect(took).toBeLessThan(8_000)
  }, 30_000)

  it('writes the replay it creates to its own schema, not to the application', async () => {
    const before = await replays()

    await run()

    // The build creates its replay before it stops on the configuration it
    // lacks, so one more row here is proof the child used this schema.
    expect(await replays()).toBe(before + 1)
  }, 30_000)
})

/** A replay as the API creates it before spawning the build: a row and nothing else. */
async function aCreatedReplay(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into replay (period_from, period_to, created_at, updated_at, state)
     values ('2019-10-22T00:00:00Z', '2019-10-23T00:00:00Z', now(), now(), 'running')
     returning id`,
  )
  return rows[0]!.id
}

describe('a build named after an existing replay', () => {
  it('goes into the one the API has just created', async () => {
    const id = await aCreatedReplay()

    const { code, stderr } = await run({}, [`--id=${id}`])

    expect(stderr).not.toMatch(/UsageError/)
    expect(stderr).toMatch(/ConfigurationError/)
    expect(code).toBe(1)
  }, 30_000)

  it('is refused once a build has started on it', async () => {
    const id = await aCreatedReplay()
    await run({}, [`--id=${id}`])

    const { code, stderr } = await run({}, [`--id=${id}`])

    expect(stderr).toMatch(/UsageError: --id .* names a replay a build has already started/)
    expect(code).toBe(1)
  }, 30_000)

  it('goes to one of two builds started on it together, and only one', async () => {
    const id = await aCreatedReplay()

    const both = await Promise.all([run({}, [`--id=${id}`]), run({}, [`--id=${id}`])])

    const refused = both.filter((one) =>
      /names a replay a build has already started/.test(one.stderr),
    )
    expect(refused).toHaveLength(1)
  }, 30_000)
})

/**
 * The delivery directory arrives in batches, long after an installation, so a
 * replay has to be buildable before the first one lands.
 *
 * The hosts are under `.test`, which resolves nowhere: the lanes fail on their
 * sources, which is the point. What must not happen is stopping on a variable
 * nobody gave the build a reason to need.
 */
describe('a build with no radar delivery root', () => {
  it('runs its other lanes instead of refusing to start', async () => {
    const { code, stderr } = await run({
      ACYCLIQ_API_URL: 'https://aquasys.smmarchives.test/api',
      ACYCLIQ_TOKEN: 'x',
      LIZMAP_BASE_URL: 'https://lizmap.smmarchives.test',
    })

    expect(stderr).not.toMatch(/ConfigurationError/)
    expect(stderr).toMatch(/radar-rainfall: no delivery root configured/)
    expect(code).not.toBe(1)
  }, 30_000)
})

/** The API that spawned the build stops while it runs, taking the reading end of stderr. */
describe('a build whose progress nobody reads any more', () => {
  it('runs to its end rather than dying on the closed pipe', async () => {
    const { code } = await run(
      {
        ACYCLIQ_API_URL: 'https://aquasys.smmarchives.test/api',
        ACYCLIQ_TOKEN: 'x',
        LIZMAP_BASE_URL: 'https://lizmap.smmarchives.test',
      },
      [],
      { readerLeaves: true },
    )

    expect(code).toBe(2)
  }, 30_000)
})

async function stateOf(id: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ state: string }>('select state from replay where id = $1', [
    id,
  ])
  return rows[0]?.state
}

/** A build that stops is one nobody will settle: it must not say it is still running. */
describe('a build that stops before it settles', () => {
  let silent: Server

  beforeAll(async () => {
    // Answers nothing, ever: the build waits on it until it is told to stop.
    silent = createServer(() => {})
    await new Promise<void>((listening) => silent.listen(0, '127.0.0.1', listening))
  })

  afterAll(async () => {
    silent.closeAllConnections()
    await new Promise((closed) => silent.close(closed))
  })

  it('leaves its replay failed when it could not run', async () => {
    const id = await aCreatedReplay()

    const { code } = await run({}, [`--id=${id}`])

    expect(code).toBe(1)
    expect(await stateOf(id)).toBe('failed')
  }, 30_000)

  it('leaves its replay failed when it is told to stop', async () => {
    const id = await aCreatedReplay()
    const { port } = silent.address() as AddressInfo
    const child = spawn(
      RUNNER,
      [SCRIPT, '--from=2019-10-22T00:00:00Z', '--to=2019-10-23T00:00:00Z', `--id=${id}`],
      {
        cwd: CHECKOUT,
        env: environment({
          ACYCLIQ_API_URL: `http://127.0.0.1:${port}/api`,
          ACYCLIQ_TOKEN: 'x',
          LIZMAP_BASE_URL: `http://127.0.0.1:${port}`,
        }),
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    const exited = new Promise<number | null>((settle) => child.once('close', settle))

    // Stopped once it is under way, not while it is still starting.
    await new Promise<void>((started) =>
      child.stderr.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes(`replay ${id}`)) started()
      }),
    )
    child.kill('SIGTERM')

    expect(await exited).toBe(1)
    expect(await stateOf(id)).toBe('failed')
  }, 30_000)
})
