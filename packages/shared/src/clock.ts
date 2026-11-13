import { z } from 'zod'

/**
 * An absolute instant, ISO 8601 with an explicit `Z`: the single clock every
 * source is normalised to on import, whatever it sends. Mixed clocks
 * desynchronise the map, the timeline and the charts without a sign on screen.
 */
export type Instant = string

export const instantSchema = z.iso.datetime()

export const timeWindowSchema = z.object({ from: instantSchema, to: instantSchema })

export type TimeWindow = z.infer<typeof timeWindowSchema>

/**
 * Epoch values outside this range are a unit mistake, not data: seconds read as
 * milliseconds land in 1970, milliseconds read as seconds past the year 50000.
 * The floor stays under 1979, the oldest chronicle start Aquasys serves.
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

/**
 * A date and a time, then `Z` or an offset: what names one instant whatever
 * the zone of the process reading it.
 */
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i

/**
 * Normalises a date string naming its zone onto the single clock, and refuses
 * one that names none: `Date.parse` would read it in the zone of the host.
 */
export function parseInstant(value: string, subject = 'date'): Instant {
  const milliseconds = ZONED.test(value) ? Date.parse(value) : Number.NaN
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

/**
 * A replay's period: a window that lasts, which the database requires, where
 * {@link windowOf} accepts a single instant as a filter needs.
 */
export function periodOf(from: string, to: string): TimeWindow {
  const window = windowOf(from, to)
  if (toEpochMilliseconds(window.from) === toEpochMilliseconds(window.to)) {
    throw new RangeError(`Period lasts no time: ${window.from} → ${window.to}`)
  }
  return window
}

/** Bounds are inclusive: an observation exactly on the hour belongs to the window. */
export function isWithin(instant: Instant, window: TimeWindow): boolean {
  const at = toEpochMilliseconds(instant)
  return at >= toEpochMilliseconds(window.from) && at <= toEpochMilliseconds(window.to)
}

/**
 * Drops what falls outside the requested window, which Aquasys widens to whole
 * UTC days whatever the time asked for.
 */
export function cropToWindow<T>(
  items: readonly T[],
  window: TimeWindow,
  instantOf: (item: T) => Instant,
): T[] {
  // Bounds parsed once rather than per item: this runs over every measure of a run.
  const from = toEpochMilliseconds(window.from)
  const to = toEpochMilliseconds(window.to)
  return items.filter((item) => {
    const at = toEpochMilliseconds(instantOf(item))
    return at >= from && at <= to
  })
}

/**
 * Median interval between consecutive instants, in minutes to a tenth, or `null`
 * below two: the density a series actually has, Aquasys's being event-driven.
 */
export function medianStepMinutes(instants: readonly Instant[]): number | null {
  return medianStepOf(instants.map(toEpochMilliseconds))
}

/** The same, for a caller already holding epoch milliseconds. */
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
