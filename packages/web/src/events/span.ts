import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import type { Cursor } from '../transport/reading.ts'

/**
 * How long a point in time stays on screen.
 *
 * An event with no end is an instant — a photograph, a phone call — and the
 * contract keeps it so. An instant drawn as such is a sliver nobody sees go by
 * at sixty minutes a second, so the screen gives it this much, and only the
 * screen: what the replay holds still says it had no end.
 */
export const A_MOMENT = 60 * 1000

/** Where an event stops being drawn as current. */
export function shownUntil(event: Pick<ReplayEvent, 'from' | 'to'>): Cursor {
  return event.to === null ? Date.parse(event.from) + A_MOMENT : Date.parse(event.to)
}

/**
 * Where an event stands at an instant.
 *
 * `past` and not gone: a road cut at ten in the morning is still a fact of the
 * day at four in the afternoon, and the map keeps it, dimmed.
 */
export function phaseAt(
  event: Pick<ReplayEvent, 'from' | 'to'>,
  at: Cursor,
): 'ahead' | 'ongoing' | 'past' {
  if (at < Date.parse(event.from)) return 'ahead'
  return at <= shownUntil(event) ? 'ongoing' : 'past'
}

/** The events an agent wrote, which the screen draws apart from the crossings. */
export function writtenIn(events: readonly ReplayEvent[]): ReplayEvent[] {
  return events.filter((one) => one.origin === 'manual')
}
