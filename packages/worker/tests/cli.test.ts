import { ConfigurationError, ExitCode, SourceError } from '@smmarchives/shared'
import { describe, expect, it, vi } from 'vitest'

import { UsageError, runProcess, toExtent, toReplayId, toTerritory, toWindow } from '../src/cli.ts'

/**
 * What every command of the worker rests on, exercised through `runProcess`
 * itself rather than through any one command.
 *
 * Nothing else pins it: swapping `process.exitCode` for `process.exit()`, or
 * letting a diagnostic escape onto stdout, would leave every other test green
 * while breaking the API, which reads the exit code of the build it launched.
 */
async function run(outcome: () => Promise<ExitCode>) {
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

describe('a process that stores rather than returns', () => {
  it('leaves stdout empty, because the data went to storage', async () => {
    const { stdout, exitCode } = await run(async () => ExitCode.success)

    expect(stdout).toBe('')
    expect(exitCode).toBe(ExitCode.success)
  })

  it('reports the code the run decided, including a partial one', async () => {
    const { exitCode } = await run(async () => ExitCode.partial)
    expect(exitCode).toBe(ExitCode.partial)
  })
})

describe('a process that could not run', () => {
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
      throw new ConfigurationError('MEDIA_PATH', 'is required and empty')
    })

    expect(exitCode).toBe(ExitCode.failure)
    expect(stderr).toContain('MEDIA_PATH')
  })

  it('reports a bad argument as usage, not as a crash', async () => {
    const { stderr, exitCode } = await run(async () => {
      throw new UsageError('--from and --to are both required')
    })

    expect(exitCode).toBe(ExitCode.failure)
    expect(stderr).toContain('UsageError')
    expect(stderr).not.toContain('at ')
  })
})

/**
 * The same four-number format arrives from a flag and from an environment
 * variable, with two different consequences. One parser, two errors.
 */
describe('the territory read from the command line', () => {
  const extent = { minLon: 2.1, minLat: 43.1, maxLon: 2.5, maxLat: 43.3 }

  it('is a basin union, by the short name a list shows', () => {
    expect(toTerritory('Aude Centre', extent)).toBe('Aude Centre')
    expect(() => toTerritory('Narbonne', extent)).toThrow('--territory must name a basin union')
  })

  it('names an extent, and nothing without one', () => {
    expect(() => toTerritory('Aude Centre', undefined)).toThrow('--territory needs --bbox')
    expect(toTerritory(undefined, undefined)).toBeUndefined()
  })
})

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

  it('is refused past the SMMAR territory, even by a single side', () => {
    expect(() => toExtent('2.0,42.7,3.2,43.7')).toThrow(
      '--bbox must lie within the SMMAR territory',
    )
    expect(() => toExtent('5.3,43.2,5.5,43.4')).toThrow(UsageError)
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

  it('accepts the identifier the database minted, and nothing else', () => {
    expect(toReplayId('c4a7c5be-73d0-48db-aa17-8be7b314f863')).toBe(
      'c4a7c5be-73d0-48db-aa17-8be7b314f863',
    )
    expect(() => toReplayId('aude-2018-10')).toThrow(/--id/)
  })
})

describe('the period read from the command line', () => {
  it('is refused when it lasts no time, before the database is asked to store it', () => {
    expect(() => toWindow('2019-10-22T00:00:00Z', '2019-10-22T00:00:00.000Z')).toThrow(UsageError)
  })

  it('is read when it lasts', () => {
    expect(toWindow('2019-10-22T00:00:00Z', '2019-10-23T00:00:00Z')).toEqual({
      from: '2019-10-22T00:00:00.000Z',
      to: '2019-10-23T00:00:00.000Z',
    })
  })
})
