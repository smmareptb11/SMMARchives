import { parseArgs, type ParseArgsConfig } from 'node:util'

import {
  ConfigurationError,
  ContractError,
  ExitCode,
  SourceError,
  parseBoundingBox,
  replayIdSchema,
  windowOf,
  type BoundingBox,
  type LaneName,
  type TimeWindow,
} from '@smmarchives/shared'

/**
 * Runs a process that stores what it collected instead of returning it.
 *
 * Nothing goes on stdout — the data went to storage — so the exit code carries
 * the whole outcome: the run decides between complete and partial, and only a
 * run that could not start at all exits 1.
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

/**
 * The geographic extent of the replay. Given, a build collects only the
 * sources inside it; omitted, it collects the whole fleet, which is what the
 * SMMAR territory itself amounts to.
 */
export function toExtent(value: string | undefined): BoundingBox | undefined {
  if (value === undefined) return undefined
  return parseBoundingBox(value, (reason) => new UsageError(`--bbox ${reason}`))
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
