import type { TimeWindow } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import type { Cursor } from '../transport/reading.ts'

/** The events agents reported, in order: told by their origin, never by a missing source. */
export function reportsOf(events: readonly ReplayEvent[]): ReplayEvent[] {
  return events
    .filter((one) => one.origin === 'manual')
    .sort((one, other) => one.from.localeCompare(other.from) || one.id.localeCompare(other.id))
}

/**
 * The row each span is drawn on, so that none hides another: the first row whose
 * last span has ended by its start, spans that only touch sharing one. Taken in
 * the order given, which is the order they began.
 */
export function rowsOf(spans: readonly { left: number; width: number }[]): number[] {
  const ends: number[] = []

  return spans.map((span) => {
    const free = ends.findIndex((end) => end <= span.left)
    const row = free === -1 ? ends.length : free
    ends[row] = span.left + span.width
    return row
  })
}

/**
 * Where the reading goes when an event's sheet opens: its start, held within the
 * period, since a reading never stands outside the replay it reads.
 */
export function instantToRead(event: ReplayEvent, period: TimeWindow): Cursor {
  const from = Date.parse(event.from)
  return Math.min(Math.max(from, Date.parse(period.from)), Date.parse(period.to))
}
