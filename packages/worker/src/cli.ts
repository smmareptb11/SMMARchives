import { parseArgs, type ParseArgsConfig } from 'node:util'

import type { z } from 'zod'

import type { SourceScope } from './sources/aquasys/source-ids.ts'

import {
  ConfigurationError,
  ContractError,
  ExitCode,
  ReportCollector,
  SourceError,
  checkEnvelope,
  exitCodeFor,
  sourceFamilySchema,
  parseBoundingBox,
  replayIdSchema,
  windowOf,
  type BoundingBox,
  type Envelope,
  type LaneName,
  type Report,
  type SourceFamily,
  type TimeWindow,
} from '@smmarchives/shared'

/**
 * Runs a collection script under the contract every script shares.
 *
 * stdout carries the envelope and nothing else, so it stays pipeable; progress
 * and diagnostics go to stderr. An empty `data` is a success — only a script
 * that could not run at all exits non-zero with nothing on stdout. The exit
 * code is derived from the report rather than declared, so a run that recorded
 * a failure cannot present itself as complete.
 */
export async function runScript<T>(
  /** The contract this script's `data` obeys, checked before anything is emitted. */
  contract: z.ZodType,
  run: () => Promise<Envelope<T>>,
): Promise<void> {
  await runProcess(async () => {
    const { data, report } = await run()
    checkEnvelope(contract, { data, report })
    summarise(report)
    // Two writes rather than one template literal: the JSON string is already
    // flat, and interpolating it would copy all 19 MB of a measures run again.
    process.stdout.write(JSON.stringify({ data, report } satisfies Envelope<T>))
    process.stdout.write('\n')
    return exitCodeFor(report)
  })
}

/**
 * Runs a process that stores what it collected instead of returning it.
 *
 * Nothing goes on stdout — the data went to storage — so the exit code carries
 * the whole outcome: the run decides between complete and partial, and only a
 * run that could not start at all exits 1.
 *
 * Also the shell {@link runScript} runs inside, so how a thrown error becomes a
 * diagnostic and an exit code is written once for both.
 */
export async function runProcess(run: () => Promise<ExitCode>): Promise<void> {
  try {
    process.exitCode = await run()
  } catch (error) {
    printFatal(error)
    process.exitCode = ExitCode.failure
  }
}

export function progress(message: string): void {
  process.stderr.write(`${message}\n`)
}

/** A collector whose progress reaches the terminal. The only place stderr is wired. */
export function reportCollector(script: string, request: Record<string, unknown>): ReportCollector {
  return new ReportCollector(script, request, { onProgress: progress })
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export function parseCliArgs<T extends NonNullable<ParseArgsConfig['options']>>(
  options: T,
): ReturnType<typeof parseArgs<{ options: T; strict: true; allowPositionals: false }>>['values'] {
  try {
    return parseArgs({ options, strict: true, allowPositionals: false }).values
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

export function toFamily(value: string): SourceFamily {
  const parsed = sourceFamilySchema.safeParse(value)
  if (!parsed.success) {
    throw new UsageError(`--family must be one of ${sourceFamilySchema.options.join(', ')}`)
  }
  return parsed.data
}

export function toFamilies(value: string | undefined): SourceFamily[] {
  return value === undefined ? [...sourceFamilySchema.options] : [toFamily(value)]
}

/**
 * The geographic extent of the replay. Given, a script collects only the
 * sources inside it; omitted, it collects the whole fleet, which is what the
 * SMMAR territory itself amounts to.
 */
export function toExtent(value: string | undefined): BoundingBox | undefined {
  if (value === undefined) return undefined
  return parseBoundingBox(value, (reason) => new UsageError(`--bbox ${reason}`))
}

/**
 * Turns the two selection flags into the single choice the collectors take.
 *
 * `--bbox` and `--station` answer the same question, so giving both is refused
 * here, at the boundary, where a wrong flag belongs. Downstream the choice is
 * one value and the contradiction is unrepresentable.
 */
export function toSourceScope(
  bbox: string | undefined,
  station: string[] | undefined,
): SourceScope {
  const ids = toIntegers(station, '--station')
  const extent = toExtent(bbox)

  if (ids !== undefined && extent !== undefined) {
    throw new UsageError('--station and --bbox select the same thing two ways; give one')
  }
  if (ids !== undefined) return { kind: 'ids', ids }
  if (extent !== undefined) return { kind: 'extent', extent }
  return { kind: 'whole-family' }
}

/**
 * The identifier of a replay, which also names the directory holding its media.
 *
 * Checked here rather than at the store, because a separator in it would escape
 * that directory. A replay is named by the database now, so a flag carrying one
 * names a replay that already exists.
 */
export function toReplayId(value: string): string {
  const parsed = replayIdSchema.safeParse(value)
  if (!parsed.success) {
    throw new UsageError(`--id ${parsed.error.issues[0]?.message ?? 'is not a usable identifier'}`)
  }
  return parsed.data
}

/**
 * The lanes `--only` can select.
 *
 * Not derived from `laneNameSchema` on purpose, though it is a subset of it:
 * what makes a lane selectable is that this CLI knows how to build its source,
 * which is a fact about this file. Derived, a lane added to the schema would
 * become selectable here before anything could give it a source, and `--only`
 * would then build an empty replay in silence — worse than refusing a name it
 * does not know yet. `satisfies` keeps the two from drifting apart on a typo.
 */
const COLLECTING_LANES = [
  'aquasys',
  'lizmap',
  'radar-rainfall',
] as const satisfies readonly LaneName[]

export type CollectingLane = (typeof COLLECTING_LANES)[number]

/**
 * Which lanes to collect from, all of them by default.
 *
 * An unknown name is refused, naming what is accepted; a name given twice is
 * the same request twice and reduces to one. The order of the constant decides
 * nothing but the wording of that refusal — which lane runs first is
 * `buildReplay`'s business.
 */
export function toLanes(values: readonly string[] | undefined): Set<CollectingLane> {
  if (values === undefined) return new Set(COLLECTING_LANES)

  for (const value of values) {
    if (!COLLECTING_LANES.includes(value as CollectingLane)) {
      throw new UsageError(`--only must be one of ${COLLECTING_LANES.join(', ')}`)
    }
  }
  return new Set(values as readonly CollectingLane[])
}

export function toIntegers(
  values: readonly string[] | undefined,
  flag: string,
): number[] | undefined {
  if (values === undefined) return undefined
  return values.map((value) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed)) throw new UsageError(`${flag}: ${value} is not an integer`)
    return parsed
  })
}

export function toWindow(from: string | undefined, to: string | undefined): TimeWindow {
  if (from === undefined || to === undefined) {
    throw new UsageError('--from and --to are both required')
  }
  try {
    return windowOf(from, to)
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

export function toOptionalWindow(
  from: string | undefined,
  to: string | undefined,
): TimeWindow | undefined {
  if (from === undefined && to === undefined) return undefined
  return toWindow(from, to)
}

/** Reports what a run found, before its envelope goes out on stdout. */
function summarise(report: Report): void {
  const parts = [report.script]
  if (report.sourcesWithoutData.length > 0) {
    parts.push(`${report.sourcesWithoutData.length} source(s) without data`)
  }
  if (report.fallbacks.length > 0) parts.push(`${report.fallbacks.length} fallback(s)`)
  if (report.failures.length > 0) parts.push(`${report.failures.length} failure(s)`)
  progress(parts.length === 1 ? `${report.script}: nothing to report` : parts.join(', '))
  for (const failure of report.failures) {
    progress(`  failed  ${failure.subject}: ${failure.message}`)
  }
}

function printFatal(error: unknown): void {
  if (error instanceof SourceError) {
    progress(error.toString())
    return
  }
  if (
    error instanceof ConfigurationError ||
    error instanceof UsageError ||
    error instanceof ContractError
  ) {
    progress(`${error.name}: ${error.message}`)
    return
  }
  progress(error instanceof Error ? (error.stack ?? error.message) : String(error))
}
