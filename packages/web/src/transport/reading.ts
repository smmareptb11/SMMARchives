import {
  fromEpochMilliseconds,
  toEpochMilliseconds,
  type Instant,
  type TimeWindow,
} from '@smmarchives/shared/clock.ts'

/*
 * The model of a reading: where it is, how fast it moves, and where it can jump.
 *
 * Not an hour of the day — `@smmarchives/shared/clock.ts` owns instants, the
 * time window and what a plausible date is, and this file rests on it. Naming
 * this one `clock.ts` too made every import a question about which of the two.
 */

/**
 * How many minutes of the replay one second of real time covers.
 *
 * A replay of 24 hours at one minute per second lasts 24 minutes, and at sixty
 * it lasts 24 seconds: the range has to span the reading of an episode and the
 * skimming of a quiet week.
 */
export const SPEEDS = [1, 5, 15, 60] as const

export type Speed = (typeof SPEEDS)[number]

/**
 * Where the reading is, in milliseconds since the epoch.
 *
 * A number and not an `Instant`: it is compared and added to on every frame,
 * and parsing a string sixty times a second to add a minute to it is work for
 * nothing. It becomes an instant again at the edge, where something shows it.
 */
export type Cursor = number

export function startOf(period: TimeWindow): Cursor {
  return toEpochMilliseconds(period.from)
}

/** The cursor as an instant, which is what anything showing it needs. */
export function instantAt(cursor: Cursor): Instant {
  return fromEpochMilliseconds(cursor)
}

export function clamped(period: TimeWindow, cursor: Cursor): Cursor {
  return Math.min(Math.max(cursor, startOf(period)), endOf(period))
}

function endOf(period: TimeWindow): Cursor {
  return toEpochMilliseconds(period.to)
}

export function advanced(
  period: TimeWindow,
  cursor: Cursor,
  elapsedMs: number,
  minutesPerSecond: number,
): Cursor {
  return clamped(period, cursor + (elapsedMs / 1_000) * minutesPerSecond * 60_000)
}

export function atTheEnd(period: TimeWindow, cursor: Cursor): boolean {
  return cursor >= endOf(period)
}

export function fractionOf(period: TimeWindow, cursor: Cursor): number {
  return (cursor - startOf(period)) / spanOf(period)
}

export function cursorAt(period: TimeWindow, fraction: number): Cursor {
  return clamped(period, startOf(period) + fraction * spanOf(period))
}

function spanOf(period: TimeWindow): number {
  return endOf(period) - startOf(period)
}

/**
 * The last of a list, ordered oldest first, that is not after the cursor.
 *
 * The rule two screens read the same way: a webcam's view and a station's
 * measure both hold until the next one, so what is shown at an instant is the
 * last thing known before it. Written once, or the two would drift on the
 * instant that falls exactly on an entry.
 *
 * Halving rather than walking back from the end: an open bubble asks this on
 * every frame of the reading, over a list that can hold a thousand entries.
 */
export function lastBefore<T extends { at: Cursor }>(
  ordered: readonly T[],
  at: Cursor,
): T | undefined {
  return ordered[rankBefore(ordered, at)]
}

/**
 * The entry of a list, ordered oldest first, nearest the cursor on either side.
 *
 * The other rule, and `AGENTS.md` names what needs it: a radar rainfall image
 * is stamped with the time it was produced, never with a slot, and the products
 * of one delivery do not share their instants. An image taken four minutes
 * ahead of the reading is a better answer than one taken six minutes behind.
 *
 * A tie goes to the earlier entry, which is the one the reading has reached:
 * the later one is rain that has not fallen yet.
 */
export function nearestTo<T extends { at: Cursor }>(
  ordered: readonly T[],
  at: Cursor,
): T | undefined {
  const rank = rankBefore(ordered, at)
  const before = ordered[rank]
  const after = ordered[rank + 1]

  if (before === undefined) return after
  if (after === undefined) return before
  return at - before.at <= after.at - at ? before : after
}

/** Where the last entry not after the cursor sits, or `-1` before the first. */
function rankBefore<T extends { at: Cursor }>(ordered: readonly T[], at: Cursor): number {
  let low = 0
  let high = ordered.length - 1
  let held = -1

  while (low <= high) {
    const middle = (low + high) >> 1
    const one = ordered[middle]
    if (one === undefined) break

    if (one.at <= at) {
      held = middle
      low = middle + 1
    } else high = middle - 1
  }
  return held
}

/** Undefined rather than the cursor itself: a button with nowhere to go is disabled. */
export function nextMark(marks: readonly Cursor[], cursor: Cursor): Cursor | undefined {
  return closestOnSide(
    marks,
    (one) => one > cursor,
    (one, best) => one < best,
  )
}

export function previousMark(marks: readonly Cursor[], cursor: Cursor): Cursor | undefined {
  return closestOnSide(
    marks,
    (one) => one < cursor,
    (one, best) => one > best,
  )
}

/**
 * The closest mark on one side, whatever order the marks arrived in.
 *
 * Not `nearestTo`, which halves an ordered list and looks both ways: this one
 * walks an unordered one and only ever looks one way. Named apart because the
 * two sat here under names a letter from each other.
 */
function closestOnSide(
  marks: readonly Cursor[],
  onThatSide: (one: Cursor) => boolean,
  closer: (one: Cursor, best: Cursor) => boolean,
): Cursor | undefined {
  let found: Cursor | undefined
  for (const one of marks) {
    if (onThatSide(one) && (found === undefined || closer(one, found))) found = one
  }
  return found
}
