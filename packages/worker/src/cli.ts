import { parseArgs, type ParseArgsConfig } from 'node:util'

import {
  ConfigurationError,
  ContractError,
  ExitCode,
  SMMAR_TERRITORY,
  SourceError,
  encloses,
  parseBoundingBox,
  replayIdSchema,
  periodOf,
  type BoundingBox,
  type TimeWindow,
} from '@smmarchives/shared'
import { isUnion } from '@smmarchives/shared/reference/perimeters.ts'

/**
 * Lets the process outlive whoever read its progress: once the API that
 * started a build stops, the next line meets a closed pipe, which must not kill
 * the build. Its own trace is the journal, in the database.
 */
function ignoreGoneReader(error: NodeJS.ErrnoException): void {
  if (error.code !== 'EPIPE') throw error
}

/**
 * Runs a process that stores what it collected instead of returning it, so the
 * exit code carries the whole outcome: only a run that could not start exits 1.
 */
export async function runProcess(run: () => Promise<ExitCode>): Promise<void> {
  process.stderr.on('error', ignoreGoneReader)
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
 * sources inside it, which must lie within the SMMAR territory; omitted, it
 * collects the whole fleet, which is what that territory itself amounts to.
 */
export function toExtent(value: string | undefined): BoundingBox | undefined {
  if (value === undefined) return undefined
  const extent = parseBoundingBox(value, (reason) => new UsageError(`--bbox ${reason}`))
  if (!encloses(SMMAR_TERRITORY, extent)) {
    throw new UsageError('--bbox must lie within the SMMAR territory')
  }
  return extent
}

/** The basin union an extent was framed on, which names nothing without one. */
export function toTerritory(
  value: string | undefined,
  extent: BoundingBox | undefined,
): string | undefined {
  if (value === undefined) return undefined
  if (!isUnion(value)) throw new UsageError('--territory must name a basin union')
  if (extent === undefined) throw new UsageError('--territory needs --bbox')
  return value
}

/**
 * The identifier of an existing replay, which also names the directory holding
 * its media: a separator in it would escape that directory.
 */
export function toReplayId(value: string): string {
  const parsed = replayIdSchema.safeParse(value)
  if (!parsed.success) {
    throw new UsageError(`--id ${parsed.error.issues[0]?.message ?? 'is not a usable identifier'}`)
  }
  return parsed.data
}

export function toWindow(from: string | undefined, to: string | undefined): TimeWindow {
  if (from === undefined || to === undefined) {
    throw new UsageError('--from and --to are both required')
  }
  try {
    return periodOf(from, to)
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
