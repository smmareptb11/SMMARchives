import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

/**
 * The events agents reported, in the order they happened.
 *
 * Told apart by their origin and never by a missing source: a crossing is
 * derived from a station, and a fact an agent wrote down belongs to none.
 */
export function reportsOf(events: readonly ReplayEvent[]): ReplayEvent[] {
  return events
    .filter((one) => one.origin === 'manual')
    .sort((one, other) => one.from.localeCompare(other.from) || one.id.localeCompare(other.id))
}

/** How many of the replay's events a computation derived, which is what the crossings are. */
export function crossingsIn(events: readonly ReplayEvent[]): number {
  return events.filter((one) => one.origin === 'automatic').length
}

/**
 * The row each span is drawn on, so that none hides another.
 *
 * Two agents reporting the same instant would otherwise draw one mark over the
 * other, and the one underneath could neither be seen nor clicked. Each span
 * takes the first row whose last span has ended by its start; spans that only
 * touch share a row. Taken in the order given, which is the order they began.
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
