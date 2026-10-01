import { z } from 'zod'

import { instantSchema } from './clock.ts'
import { ExitCode, SourceError } from './errors.ts'

/**
 * A rule the collector could not apply as written, and what it did instead.
 *
 * Several classifications degrade rather than fail — an untyped station, a
 * threshold without `category`. The degraded path is reported, never applied in
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
 * What the run did, beside what it returned.
 *
 * The rule that decides what belongs here: **the report carries what `data`
 * cannot show.** Absences, degraded rules, failed calls, rows that never
 * reached the output, and the parameters actually used. A count of what is in
 * `data` is not a finding — the caller holds `data`.
 *
 * Open on purpose, because each collection has its own non-derivable measurements:
 * the density obtained per source, whether a period predates a retention.
 */
export const reportSchema = z.looseObject({
  script: z.string(),
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
 * Raised when a collector produced data its own contract refuses.
 *
 * Not a source failure: the source answered, and the mapping between it and
 * the contract is what broke. Which is why the message points at the mapper
 * rather than at the schema.
 */
export class ContractError extends Error {
  constructor(readonly detail: string) {
    super(detail)
    this.name = 'ContractError'
  }
}

/**
 * Checks an envelope against the contract its data set is stored under.
 *
 * The contracts of `contracts/` used to be inert — sixteen schemas, eleven of
 * them never parsed, declaring bounds and formats that nothing enforced. One
 * of those inert bounds was on coordinates, and the coordinate bug the review
 * found would have been impossible had it run. Measured cost on the largest
 * run the project has: 42 ms for 175 000 measures, against 40 to 60 s of
 * sequential HTTP.
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
 * The exit code a report implies.
 *
 * An empty result is a success; a truncated one is not. Derived from the report
 * rather than declared by the caller, so a run that recorded a failure cannot
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
 * Accumulates a {@link Report} while a collection runs, and carries the run's
 * progress channel.
 *
 * Collectors note as they go and the caller seals once. The progress sink lives
 * here rather than in the collection modules so that a server-side job can
 * route connector progress into a job log instead of onto stderr.
 */
export class ReportCollector {
  readonly #script: string
  readonly #request: Record<string, unknown>
  readonly #onProgress: (message: string) => void
  readonly #sourcesWithoutData: Array<string | number> = []
  readonly #fallbacks: Fallback[] = []
  readonly #failures: Failure[] = []

  constructor(
    script: string,
    request: Record<string, unknown>,
    options: ReportCollectorOptions = {},
  ) {
    this.#script = script
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
      script: this.#script,
      ranAt: new Date().toISOString(),
      request: this.#request,
      sourcesWithoutData: this.#sourcesWithoutData,
      fallbacks: this.#fallbacks,
      failures: this.#failures,
      ...extra,
    }
  }
}
