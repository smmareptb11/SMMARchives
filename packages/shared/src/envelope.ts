import { z } from 'zod'

import { instantSchema } from './clock.ts'
import { ExitCode, SourceError } from './errors.ts'

/**
 * A rule the collector could not apply as written, and what it did instead: a
 * classification that degrades rather than fails is reported, never applied in
 * silence.
 */
export const fallbackSchema = z.object({
  subject: z.string(),
  rule: z.string(),
  applied: z.string(),
})

export type Fallback = z.infer<typeof fallbackSchema>

/** One call that failed while the run as a whole succeeded. */
export const failureSchema = z.object({
  subject: z.string(),
  message: z.string(),
  status: z.number().int().optional(),
  url: z.string().optional(),
})

export type Failure = z.infer<typeof failureSchema>

/**
 * What the run did, beside what it returned: only what `data` cannot show, such
 * as absences, degraded rules, failed calls, rows that never reached the output
 * and the parameters actually used. Never a count of what `data` holds.
 *
 * Open, for what one collection alone measures: the density obtained per source,
 * whether a period predates a retention.
 */
export const reportSchema = z.looseObject({
  ranAt: instantSchema,
  request: z.record(z.string(), z.unknown()),
  /** Sources asked and answering nothing. An empty `data` cannot say which. */
  sourcesWithoutData: z.array(z.union([z.string(), z.number()])),
  fallbacks: z.array(fallbackSchema),
  failures: z.array(failureSchema),
})

export type Report = z.infer<typeof reportSchema>

export type Envelope<T> = {
  data: T
  report: Report
}

export function envelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ data, report: reportSchema })
}

/**
 * Raised when a collector produced data its own contract refuses: not a source
 * failure, since the source answered and the mapping is what broke.
 */
export class ContractError extends Error {
  constructor(readonly detail: string) {
    super(detail)
    this.name = 'ContractError'
  }
}

/**
 * Checks an envelope against the contract its data set is stored under, so that
 * the bounds and formats the contract declares are enforced before storage.
 */
export function checkEnvelope<T>(schema: z.ZodType, envelope: Envelope<T>): void {
  const parsed = envelopeSchema(schema).safeParse(envelope)
  if (parsed.success) return

  const issue = parsed.error.issues[0]
  const where = issue === undefined ? 'the envelope' : issue.path.join('.')
  throw new ContractError(
    [
      `[contract] ${where}: ${issue?.message ?? 'does not match the declared contract'}`,
      '',
      'A collector produced a value its own contract refuses. The source answered;',
      'the mapping between what it returned and the contract is what broke.',
      '',
      'Expected: every value in `data` satisfies the schema its data set is stored',
      'under, so the API and the interface can serve it without re-checking.',
      '',
      'Fix the mapper in sources/, or the decoding rule that produced this value.',
      '',
      'Do NOT widen the schema or drop the check to get past this: the contracts are',
      'what the API and the interface will import, and a bound that never runs is how',
      'a longitude of 1000 reached production once already.',
      '',
      'See packages/shared/src/contracts/.',
    ].join('\n'),
  )
}

/**
 * The exit code a report implies: an empty result is a success, a truncated one
 * is not. Derived rather than declared, so a run that recorded a failure cannot
 * present itself as complete.
 */
export function exitCodeFor(report: Report): ExitCode {
  return report.failures.length > 0 ? ExitCode.partial : ExitCode.success
}

export type ReportCollectorOptions = {
  /** Where progress lines go. Silent by default, so `sources/` needs no sink. */
  onProgress?: ((message: string) => void) | undefined
}

/**
 * Accumulates a {@link Report} while a collection runs, and carries its progress
 * channel, so that a server-side job can route a connector's progress into its
 * own log rather than onto stderr.
 */
export class ReportCollector {
  readonly #request: Record<string, unknown>
  readonly #onProgress: (message: string) => void
  readonly #sourcesWithoutData: Array<string | number> = []
  readonly #fallbacks: Fallback[] = []
  readonly #failures: Failure[] = []

  constructor(request: Record<string, unknown>, options: ReportCollectorOptions = {}) {
    this.#request = request
    this.#onProgress = options.onProgress ?? (() => {})
  }

  withoutData(source: string | number): void {
    this.#sourcesWithoutData.push(source)
  }

  fellBackTo(fallback: Fallback): void {
    this.#fallbacks.push(fallback)
  }

  failed(subject: string, error: unknown): void {
    this.#failures.push(
      error instanceof SourceError
        ? { subject, message: error.message, status: error.status, url: error.url }
        : { subject, message: error instanceof Error ? error.message : String(error) },
    )
  }

  progress(message: string): void {
    this.#onProgress(message)
  }

  /** A counter that reports one line every `step` items, for long fan-outs. */
  progressEvery(total: number, label: string, step = 25): () => void {
    let done = 0
    return () => {
      done += 1
      if (done % step === 0) this.progress(`  ${label} ${done}/${total}`)
    }
  }

  seal(extra: Record<string, unknown> = {}): Report {
    return {
      ranAt: new Date().toISOString(),
      request: this.#request,
      sourcesWithoutData: this.#sourcesWithoutData,
      fallbacks: this.#fallbacks,
      failures: this.#failures,
      ...extra,
    }
  }
}
