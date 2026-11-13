import {
  fromEpochMilliseconds,
  toEpochMilliseconds,
  type Instant,
  type TimeWindow,
} from '@smmarchives/shared/clock.ts'

/*
 * The model of a reading: where it is, how fast it moves, and where it can jump.
 * Instants and the time window belong to `@smmarchives/shared/clock.ts`.
 */

/**
 * How many minutes of the replay one second of real time covers: enough range to
 * read an episode and to skim a quiet week.
 */
export const SPEEDS = [1, 5, 15, 60] as const

export type Speed = (typeof SPEEDS)[number]

/**
 * Where the reading is, in milliseconds since the epoch: a number rather than an
 * `Instant`, since it is added to on every frame. It becomes an instant again
 * where something shows it.
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

/**
 * The longest a frame may count for: a browser stops drawing a tab nobody looks
 * at, and the first frame back would count the whole absence.
 */
export const LONGEST_FRAME_MS = 250

/** The time a frame accounts for, from the one before it. */
export function frameElapsed(now: number, last: number): number {
  return Math.min(Math.max(now - last, 0), LONGEST_FRAME_MS)
}

/** How far a step of the keyboard moves the reading. */
export const STEP_MS = 60 * 60_000

/** The reading a step later, or earlier, held within the period. */
export function stepped(period: TimeWindow, cursor: Cursor, direction: 1 | -1): Cursor {
  return clamped(period, cursor + direction * STEP_MS)
}

/** What a key does to the reading. */
export type Shortcut = 'toggle' | 'next' | 'previous' | 'forward' | 'back'

/**
 * What holds the focus when a key is pressed: a field typed into, something
 * pressed with space, the map, or nothing of the kind.
 */
export type KeyFocus = 'typing' | 'pressable' | 'map' | 'none'

/**
 * What a key does to the reading, or nothing where the focus already gives it a
 * meaning: a field keeps every key; a button or a checkbox keeps space and leaves
 * the arrows to the reading; the map keeps the arrows, which pan it.
 */
export function shortcutFor(key: string, shift: boolean, focus: KeyFocus): Shortcut | undefined {
  if (focus === 'typing') return undefined
  if (key === ' ') return focus === 'pressable' ? undefined : 'toggle'
  const arrow = ARROWS[key]
  if (arrow === undefined || focus === 'map') return undefined
  return shift ? arrow.shifted : arrow.alone
}

/** What each arrow does alone, and with Shift. */
const ARROWS: Partial<Record<string, { alone: Shortcut; shifted: Shortcut }>> = {
  ArrowRight: { alone: 'next', shifted: 'forward' },
  ArrowLeft: { alone: 'previous', shifted: 'back' },
}

export function atTheEnd(period: TimeWindow, cursor: Cursor): boolean {
  return cursor >= endOf(period)
}

/**
 * Whether the reading goes on once a drag lets it go: only if it was playing
 * when the drag began, and never from the end, where it would advance nothing.
 */
export function resumes(wasPlaying: boolean, period: TimeWindow, cursor: Cursor): boolean {
  return wasPlaying && !atTheEnd(period, cursor)
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
 * The last of a list, ordered oldest first, that is not after the cursor: the one
 * rule by which a webcam's view and a station's measure hold until the next.
 * Halving, since an open bubble asks this on every frame.
 */
export function lastBefore<T extends { at: Cursor }>(
  ordered: readonly T[],
  at: Cursor,
): T | undefined {
  let low = 0
  let high = ordered.length - 1
  let held: T | undefined

  while (low <= high) {
    const middle = (low + high) >> 1
    const one = ordered[middle]
    if (one === undefined) break

    if (one.at <= at) {
      held = one
      low = middle + 1
    } else high = middle - 1
  }
  return held
}

/** Undefined rather than the cursor itself: a button with nowhere to go is disabled. */
export function nextMark(marks: readonly Cursor[], cursor: Cursor): Cursor | undefined {
  return nearest(
    marks,
    (one) => one > cursor,
    (one, best) => one < best,
  )
}

export function previousMark(marks: readonly Cursor[], cursor: Cursor): Cursor | undefined {
  return nearest(
    marks,
    (one) => one < cursor,
    (one, best) => one > best,
  )
}

/** The closest mark on one side, whatever order the marks arrived in. */
function nearest(
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
