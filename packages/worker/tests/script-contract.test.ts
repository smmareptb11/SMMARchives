import {
  ConfigurationError,
  ExitCode,
  ReportCollector,
  SourceError,
  type Envelope,
} from '@smmarchives/shared'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  UsageError,
  runProcess,
  runScript,
  toExtent,
  toLanes,
  toReplayId,
  toSourceScope,
} from '../src/cli.ts'

/**
 * The contract every collection script rests on, exercised through `runScript`
 * itself rather than through any one script.
 *
 * Nothing else pins it: swapping `process.exitCode` for `process.exit()`, or
 * letting a diagnostic escape onto stdout, would leave every other test green
 * while breaking every caller.
 */
/** Most of these probe the contract itself, so the loosest data schema will do. */
const ANY_DATA = z.unknown()

async function run(outcome: () => Promise<Envelope<unknown>>, contract: z.ZodType = ANY_DATA) {
  const stdout: string[] = []
  const stderr: string[] = []
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  const previous = process.exitCode
  process.exitCode = undefined

  try {
    await runScript(contract, outcome)
    return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode: process.exitCode }
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
    process.exitCode = previous
  }
}

function outcomeOf(data: unknown, failure?: string): Envelope<unknown> {
  const collector = new ReportCollector('probe', {})
  if (failure !== undefined) collector.failed(failure, new Error('boom'))
  return { data, report: collector.seal() }
}

describe('a run that found nothing', () => {
  it('is a success carrying an empty envelope', async () => {
    const { stdout, exitCode } = await run(async () => outcomeOf([]))

    expect(exitCode).toBe(ExitCode.success)
    expect(JSON.parse(stdout)).toMatchObject({ data: [], report: { script: 'probe' } })
  })

  it('ends its single line of stdout with a newline', async () => {
    const { stdout } = await run(async () => outcomeOf([]))

    expect(stdout.endsWith('\n')).toBe(true)
    expect(stdout.trimEnd()).not.toContain('\n')
  })
})

describe('a run that could not happen', () => {
  it('writes nothing on stdout and exits 1', async () => {
    const { stdout, exitCode } = await run(async () => {
      throw new SourceError('HTTP 500', { url: 'https://api.test/x', status: 500 })
    })

    expect(stdout).toBe('')
    expect(exitCode).toBe(ExitCode.failure)
  })

  it('puts the url and the status where a reader can act on them', async () => {
    const { stderr } = await run(async () => {
      throw new SourceError('HTTP 500', {
        url: 'https://api.test/x?token=secret',
        status: 500,
        body: 'boom',
      })
    })

    expect(stderr).toContain('status 500')
    expect(stderr).toContain('boom')
    expect(stderr).not.toContain('secret')
  })

  it('names the missing variable', async () => {
    const { stderr, exitCode } = await run(async () => {
      throw new ConfigurationError('RADAR_RAINFALL_PATH', 'is required and empty')
    })

    expect(exitCode).toBe(ExitCode.failure)
    expect(stderr).toContain('RADAR_RAINFALL_PATH')
  })

  it('reports a bad argument as usage, not as a crash', async () => {
    const { stderr, exitCode } = await run(async () => {
      throw new UsageError('--family must be one of hydro, rain-gauge')
    })

    expect(exitCode).toBe(ExitCode.failure)
    expect(stderr).toContain('UsageError')
    expect(stderr).not.toContain('at ')
  })
})

describe('a run where some calls failed', () => {
  /**
   * The code follows from the report, so a script cannot present a truncated
   * run as a complete one by forgetting to say so.
   */
  it('still emits the envelope, and exits 2', async () => {
    const { stdout, exitCode } = await run(async () => outcomeOf([{ id: 1 }], 'station 12'))

    expect(exitCode).toBe(ExitCode.partial)
    expect(JSON.parse(stdout)).toMatchObject({ data: [{ id: 1 }] })
  })
})

/**
 * The main process stores instead of returning, so it cannot lean on
 * `runScript`. What it must keep is the other half of the contract: the exit
 * code, and a diagnostic a reader can act on.
 */
describe('a process that stores rather than returns', () => {
  async function runIt(outcome: () => Promise<ExitCode>) {
    const stdout: string[] = []
    const stderr: string[] = []
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
    const previous = process.exitCode
    process.exitCode = undefined

    try {
      await runProcess(outcome)
      return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode: process.exitCode }
    } finally {
      outSpy.mockRestore()
      errSpy.mockRestore()
      process.exitCode = previous
    }
  }

  it('leaves stdout empty, because the data went to storage', async () => {
    const { stdout, exitCode } = await runIt(async () => ExitCode.success)

    expect(stdout).toBe('')
    expect(exitCode).toBe(ExitCode.success)
  })

  it('reports the code the run decided, including a partial one', async () => {
    const { exitCode } = await runIt(async () => ExitCode.partial)
    expect(exitCode).toBe(ExitCode.partial)
  })

  it('names a missing variable and exits 1 when it could not start', async () => {
    const { stderr, exitCode } = await runIt(async () => {
      throw new ConfigurationError('MEDIA_PATH', 'is required and empty')
    })

    expect(exitCode).toBe(ExitCode.failure)
    expect(stderr).toContain('MEDIA_PATH')
  })
})

/**
 * The same four-number format arrives from a flag and from an environment
 * variable, with two different consequences. One parser, two errors.
 */
describe('the extent read from the command line', () => {
  it('carries the same bounds as the one read from the environment', () => {
    expect(() => toExtent('1000,2000,3000,4000')).toThrow(UsageError)
    expect(() => toExtent('2.7,43.0,3.1,43.4')).not.toThrow()
  })

  it('names the coordinate that is out of range, not the Zod rule', () => {
    expect(() => toExtent('1000,43.0,3.1,43.4')).toThrow(
      '--bbox has a minLon outside the range of valid coordinates',
    )
    expect(() => toExtent('2.7,43.0,3.1,91')).toThrow(/maxLat/)
  })

  it('says which flag is wrong, and why', () => {
    expect(() => toExtent('2.7,43.0')).toThrow(/^--bbox must be four numbers/)
    expect(() => toExtent('3.1,43.0,2.7,43.4')).toThrow(/^--bbox has its minimum past its maximum/)
  })

  it('is absent, not empty, when the flag is not given', () => {
    expect(toExtent(undefined)).toBeUndefined()
  })
})

/**
 * The identifier of a replay is a segment of an API route and the name of the
 * directory holding its media: what it refuses matters more than what it
 * accepts.
 */
describe('the identifier of a replay', () => {
  it('refuses anything that would escape its own directory', () => {
    expect(() => toReplayId('../escaped')).toThrow(UsageError)
    expect(() => toReplayId('../escaped')).toThrow(/--id/)
    expect(() => toReplayId('aude/2018')).toThrow(/--id/)
    expect(() => toReplayId('Aude 2018')).toThrow(/--id/)
  })

  it('accepts the slug an operator would actually write', () => {
    expect(toReplayId('aude-2018-10')).toBe('aude-2018-10')
  })
})

/**
 * Which lanes a build collects from. This flag decides whether an Aquasys token
 * is required at all, so what it refuses is what keeps a build with no network
 * at all possible.
 */
describe('the lanes a build is restricted to', () => {
  it('is every collecting lane when the flag is absent', () => {
    expect([...toLanes(undefined)].sort()).toEqual(['aquasys', 'lizmap', 'radar-rainfall'])
  })

  it('refuses a name that is not a lane, saying what is accepted', () => {
    expect(() => toLanes(['webcams'])).toThrow(UsageError)
    expect(() => toLanes(['webcams'])).toThrow(
      '--only must be one of aquasys, lizmap, radar-rainfall',
    )
  })

  it('refuses the lane that reads no source of its own', () => {
    expect(() => toLanes(['media'])).toThrow(UsageError)
  })

  it('reduces a name given twice to one request', () => {
    expect([...toLanes(['aquasys', 'aquasys'])]).toEqual(['aquasys'])
  })
})

/**
 * Two flags answering one question. Refused here, at the boundary, so that
 * nothing downstream has to hold a shape that can contradict itself.
 */
describe('choosing which sources a run works on', () => {
  it('refuses an extent and an explicit list together', () => {
    expect(() => toSourceScope('2.7,43.0,3.1,43.4', ['152'])).toThrow(UsageError)
    expect(() => toSourceScope('2.7,43.0,3.1,43.4', ['152'])).toThrow(/give one/)
  })

  it('reads each one alone', () => {
    expect(toSourceScope('2.7,43.0,3.1,43.4', undefined)).toEqual({
      kind: 'extent',
      extent: { minLon: 2.7, minLat: 43.0, maxLon: 3.1, maxLat: 43.4 },
    })
    expect(toSourceScope(undefined, ['84', '85'])).toEqual({ kind: 'ids', ids: [84, 85] })
  })

  it('falls back on the whole family when neither is given', () => {
    expect(toSourceScope(undefined, undefined)).toEqual({ kind: 'whole-family' })
  })
})

/**
 * The contracts of `contracts/` were inert — sixteen schemas, eleven never
 * parsed, declaring bounds and formats nothing enforced. One of those inert
 * bounds was on coordinates, and the longitude of 1000 the review found would
 * have been impossible had it run.
 */
describe('data that its own contract refuses', () => {
  const POSITIONS = z.array(z.object({ lon: z.number().min(-180).max(180) }))

  it('never reaches stdout', async () => {
    const { stdout, exitCode } = await run(async () => outcomeOf([{ lon: 1000 }]), POSITIONS)

    expect(stdout).toBe('')
    expect(exitCode).toBe(ExitCode.failure)
  })

  it('says where the value is, and not to widen the schema', async () => {
    const { stderr } = await run(async () => outcomeOf([{ lon: 1000 }]), POSITIONS)

    expect(stderr).toContain('data.0.lon')
    expect(stderr).toContain('Do NOT widen the schema')
    expect(stderr).toContain('docs/utilisation.md')
  })

  it('lets conforming data through untouched', async () => {
    const { stdout, exitCode } = await run(async () => outcomeOf([{ lon: 2.83 }]), POSITIONS)

    expect(exitCode).toBe(ExitCode.success)
    expect(JSON.parse(stdout)).toMatchObject({ data: [{ lon: 2.83 }] })
  })
})
