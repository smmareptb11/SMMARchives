import { fromEpochMilliseconds, type Instant, type TimeWindow } from '@smmarchives/shared/clock.ts'

import { formatDay, formatHour, hourOf } from '../time.ts'

const HOUR = 60 * 60 * 1000
const DAY_HOURS = 24

/** The steps a ruler may take, in hours, from the finest: hours, then days, then weeks. */
const STEPS = [1, 2, 3, 6, 12, 24, 48, 168, 336]
const LONGEST = 336

/** How many ticks a ruler holds at most: one an hour over a day. */
const AT_MOST = 24

/** A graduation of the ruler: where it stands, and what it names. */
type Tick = {
  at: Instant
  /** Where it stands, as a fraction of the period. */
  fraction: number
  /** The hour, or the day at a midnight and on a ruler graduated in days. */
  label: string
  /** One tick in two, whose label gives way where the ruler is narrow. */
  odd: boolean
  /** Three ticks in four, whose labels give way where it is narrower still. */
  minor: boolean
}

/**
 * The ticks of the ruler, on the full hours of French time: every hour over a
 * day, and the finest step that keeps a longer period to as many. A midnight
 * names its day. Read off the instants rather than counted from the start, since
 * the day the clocks change holds 23 or 25 hours; Paris's full hours are UTC's.
 */
export function ticksOf(period: TimeWindow): Tick[] {
  const from = Date.parse(period.from)
  const to = Date.parse(period.to)
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return []

  const step = stepOver(to - from)
  const kept = keeperOf(step)
  const ticks: Tick[] = []

  for (let epoch = Math.ceil(from / HOUR) * HOUR; epoch < to; epoch += HOUR) {
    const at = fromEpochMilliseconds(epoch)
    const hour = hourOf(at) ?? 0
    if (!kept(hour)) continue
    const rank = rankOf(step, hour, ticks.length)
    ticks.push({
      at,
      fraction: (epoch - from) / (to - from),
      label: hour === 0 ? formatDay(at) : formatHour(at),
      odd: rank % 2 === 1,
      minor: rank % 4 !== 0,
    })
  }
  return ticks
}

/**
 * How wide the lanes are drawn where they scroll across the period, as a phone
 * draws them: a fixed room per tick, so that two ticks always stand as far apart.
 */
export function trackWidthOf(period: TimeWindow): number {
  return ticksOf(period).length * TICK_WIDTH
}

const TICK_WIDTH = 120

/**
 * Where a tick falls in the rhythm of labels that give way: counted from
 * midnight on a ruler graduated in hours, so that the one naming the day stays,
 * and from the first tick on a ruler graduated in days.
 */
function rankOf(step: number, hour: number, before: number): number {
  return step < DAY_HOURS ? hour / step : before
}

/** The finest step that keeps a period of this length to `AT_MOST` ticks, in hours. */
function stepOver(length: number): number {
  return STEPS.find((one) => length / HOUR / one <= AT_MOST) ?? LONGEST
}

/**
 * Which full hours carry a tick, taken in order: every step-th hour of the
 * day, or every step-th midnight on a ruler graduated in days.
 */
function keeperOf(step: number): (hour: number) => boolean {
  if (step < DAY_HOURS) return (hour) => hour % step === 0

  let midnights = 0
  return (hour) => hour === 0 && midnights++ % (step / DAY_HOURS) === 0
}
