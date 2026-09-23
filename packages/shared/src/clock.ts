import { z } from 'zod'

/**
 * An absolute instant, ISO 8601 with an explicit `Z`.
 *
 * The single clock of the application. Every source is normalised to it on
 * import: Aquasys returns epoch milliseconds, Ceneau ISO 8601 UTC, radar
 * deliveries epoch seconds in the filename. Mixing them desynchronises the map,
 * the timeline and the charts without anything on screen saying so.
 */
export type Instant = string

export const instantSchema = z.iso.datetime()

export const timeWindowSchema = z.object({ from: instantSchema, to: instantSchema })

export type TimeWindow = z.infer<typeof timeWindowSchema>

/**
 * Epoch values outside this range are a unit mistake, not data.
 *
 * Seconds read as milliseconds land in January 1970, milliseconds read as
 * seconds land past the year 50000; both decode without complaint and produce a
 * replay that looks plausible and is wrong. The floor sits above January 1970
 * and below 1979, the oldest chronicle start Aquasys serves.
 */
const PLAUSIBLE_RANGE_MILLISECONDS = {
  from: Date.UTC(1975, 0, 1),
  to: Date.UTC(2100, 0, 1),
}

export function fromEpochMilliseconds(value: number): Instant {
  return toInstant(value, 'epoch milliseconds')
}

export function fromEpochSeconds(value: number): Instant {
  return toInstant(value * 1000, 'epoch seconds')
}

/** Normalises any parsable date string onto the single clock. */
export function parseInstant(value: string, subject = 'date'): Instant {
  const milliseconds = Date.parse(value)
  if (Number.isNaN(milliseconds)) {
    throw new RangeError(`Unparsable ${subject}: ${JSON.stringify(value)}`)
  }
  return toInstant(milliseconds, subject)
}

export function toEpochMilliseconds(instant: Instant): number {
  return Date.parse(instant)
}

export function windowOf(from: string, to: string): TimeWindow {
  const window = { from: parseInstant(from, 'window start'), to: parseInstant(to, 'window end') }
  if (toEpochMilliseconds(window.from) > toEpochMilliseconds(window.to)) {
    throw new RangeError(`Window ends before it starts: ${window.from} → ${window.to}`)
  }
  return window
}

/** Bounds are inclusive: an observation exactly on the hour belongs to the window. */
export function isWithin(instant: Instant, window: TimeWindow): boolean {
  const at = toEpochMilliseconds(instant)
  return at >= toEpochMilliseconds(window.from) && at <= toEpochMilliseconds(window.to)
}

/**
 * Drops what falls outside the requested window.
 *
 * Aquasys widens request bounds to whole UTC days and ignores the time part
 * altogether, so up to two extra days come back on every call and the trimming
 * has to happen here.
 */
export function cropToWindow<T>(
  items: readonly T[],
  window: TimeWindow,
  instantOf: (item: T) => Instant,
): T[] {
  // Bounds parsed once, not twice per item: this runs over 175 000 measures.
  const from = toEpochMilliseconds(window.from)
  const to = toEpochMilliseconds(window.to)
  return items.filter((item) => {
    const at = toEpochMilliseconds(instantOf(item))
    return at >= from && at <= to
  })
}

/**
 * Median interval between consecutive instants, in minutes, or `null` below two
 * instants.
 *
 * Aquasys series are event-driven — 5, 25 and 120 minute gaps within the same
 * 48 hours — so a replay has to report the density it actually obtained.
 */
export function medianStepMinutes(instants: readonly Instant[]): number | null {
  return medianStepOf(instants.map(toEpochMilliseconds))
}

/**
 * The same, for a caller already holding epoch milliseconds.
 *
 * The interface runs its gauges' totals up as numbers and would otherwise write
 * them back out as strings for this one answer to parse them again — two thirds
 * of the cost of reading a whole parc's rain.
 */
export function medianStepOf(milliseconds: readonly number[]): number | null {
  if (milliseconds.length < 2) return null

  const sorted = [...milliseconds].sort((a, b) => a - b)
  const steps: number[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    steps.push(sorted[index]! - sorted[index - 1]!)
  }
  steps.sort((a, b) => a - b)

  const middle = steps.length >> 1
  const median = steps.length % 2 === 0 ? (steps[middle - 1]! + steps[middle]!) / 2 : steps[middle]!
  return Math.round((median / 60_000) * 10) / 10
}

function toInstant(milliseconds: number, subject: string): Instant {
  if (!Number.isFinite(milliseconds)) {
    throw new RangeError(`Non-finite ${subject}: ${milliseconds}`)
  }
  if (
    milliseconds < PLAUSIBLE_RANGE_MILLISECONDS.from ||
    milliseconds > PLAUSIBLE_RANGE_MILLISECONDS.to
  ) {
    throw new RangeError(
      `Implausible ${subject}: ${milliseconds} decodes to ${new Date(milliseconds).toISOString()}`,
    )
  }
  return new Date(milliseconds).toISOString()
}
