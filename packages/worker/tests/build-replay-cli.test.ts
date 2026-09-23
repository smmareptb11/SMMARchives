import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { withDatabase } from './support/database.ts'

const CHECKOUT = fileURLToPath(new URL('../../..', import.meta.url))
const RUNNER = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../src/scripts/build-replay.ts', import.meta.url))

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
    DATABASE_URL: withDatabase(),
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
  flags: readonly string[] = [],
): Promise<{ code: number | null; took: number; stderr: string }> {
  const started = Date.now()
  const child = spawn(
    RUNNER,
    [SCRIPT, '--from=2019-10-22T00:00:00Z', '--to=2019-10-23T00:00:00Z', ...flags],
    { cwd: CHECKOUT, env: environment(extra), stdio: ['ignore', 'ignore', 'pipe'] },
  )

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
  return new Promise((settle) => {
    child.once('close', (code) => settle({ code, took: Date.now() - started, stderr }))
  })
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
    // that it stopped on one of them is the point. Not the radar root, which no
    // longer stops anything it was not asked for by name.
    expect(stderr).toMatch(/ConfigurationError/)
    expect(code).toBe(1)
    // Well under the ten seconds an idle connection pool would have held it:
    // that pool is what this asserts the command closes.
    expect(took).toBeLessThan(8_000)
  }, 30_000)
})

/**
 * The delivery directory arrives in batches, long after an installation, so a
 * replay has to be buildable before the first one lands — and `POST /replays`,
 * which passes no `--only`, has no other way of saying so.
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

  it('still refuses when that lane is the one asked for', async () => {
    const { code, stderr } = await run({}, ['--only=radar-rainfall'])

    expect(stderr).toMatch(/RADAR_RAINFALL_PATH/)
    expect(code).toBe(1)
  }, 30_000)
})
