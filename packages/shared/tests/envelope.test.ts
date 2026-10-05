import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  ContractError,
  ReportCollector,
  checkEnvelope,
  exitCodeFor,
  reportSchema,
} from '../src/envelope.ts'
import { ExitCode, SourceError } from '../src/errors.ts'

describe('the exit code of a run', () => {
  it('is a success when nothing was found', () => {
    const collector = new ReportCollector({})
    for (let id = 1; id <= 40; id += 1) collector.withoutData(id)

    const report = collector.seal()
    expect(exitCodeFor(report)).toBe(ExitCode.success)
    expect(report.sourcesWithoutData).toHaveLength(40)
  })

  it('is partial as soon as one call out of 94 failed', () => {
    const collector = new ReportCollector({})
    collector.failed('station 12', new SourceError('HTTP 500', { url: 'https://x/y', status: 500 }))

    expect(exitCodeFor(collector.seal())).toBe(ExitCode.partial)
  })
})

describe('what a report carries', () => {
  it('keeps the status and redacted url of a source failure', () => {
    const collector = new ReportCollector({})
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

  it('accepts the measurements a collection adds to it', () => {
    const collector = new ReportCollector({ delivery: '20044' })
    const report = collector.seal({ products: ['pluvio5mn'], medianStepMinutes: 5 })

    expect(reportSchema.parse(report)).toMatchObject({ products: ['pluvio5mn'] })
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
  const envelopeOf = (data: unknown) => ({ data, report: new ReportCollector({}).seal() })

  it('is stopped before it is stored', () => {
    expect(() => checkEnvelope(POSITIONS, envelopeOf([{ lon: 1000 }]))).toThrow(ContractError)
  })

  it('says where the value is, and not to widen the schema', () => {
    expect(() => checkEnvelope(POSITIONS, envelopeOf([{ lon: 1000 }]))).toThrow(/data\.0\.lon/)
    expect(() => checkEnvelope(POSITIONS, envelopeOf([{ lon: 1000 }]))).toThrow(
      /Do NOT widen the schema/,
    )
  })

  it('lets conforming data through untouched', () => {
    expect(() => checkEnvelope(POSITIONS, envelopeOf([{ lon: 2.83 }]))).not.toThrow()
  })
})
