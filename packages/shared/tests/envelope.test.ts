import { describe, expect, it } from 'vitest'

import { ReportCollector, exitCodeFor, reportSchema } from '../src/envelope.ts'
import { ExitCode, SourceError } from '../src/errors.ts'

describe('the exit code of a run', () => {
  it('is a success when nothing was found', () => {
    const collector = new ReportCollector('fetch:aquasys:thresholds', {})
    for (let id = 1; id <= 40; id += 1) collector.withoutData(id)

    const report = collector.seal()
    expect(exitCodeFor(report)).toBe(ExitCode.success)
    expect(report.sourcesWithoutData).toHaveLength(40)
  })

  it('is partial as soon as one call out of 94 failed', () => {
    const collector = new ReportCollector('fetch:aquasys:measures', {})
    collector.failed('station 12', new SourceError('HTTP 500', { url: 'https://x/y', status: 500 }))

    expect(exitCodeFor(collector.seal())).toBe(ExitCode.partial)
  })
})

describe('what a report carries', () => {
  it('keeps the status and redacted url of a source failure', () => {
    const collector = new ReportCollector('fetch:aquasys:measures', {})
    collector.failed(
      'station 12',
      new SourceError('HTTP 500', { url: 'https://x/y?token=secret', status: 500 }),
    )

    expect(collector.seal().failures[0]).toEqual({
      subject: 'station 12',
      message: 'HTTP 500',
      status: 500,
      url: 'https://x/y?token=%3Credacted%3E',
    })
  })

  it('accepts the measurements a script adds to it', () => {
    const collector = new ReportCollector('index:radar-rainfall', { delivery: '20044' })
    const report = collector.seal({ products: ['pluvio5mn'], medianStepMinutes: 5 })

    expect(reportSchema.parse(report)).toMatchObject({ products: ['pluvio5mn'] })
  })
})
