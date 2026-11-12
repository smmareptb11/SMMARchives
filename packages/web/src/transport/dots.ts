import type { TimeWindow } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { instantToRead } from '../events/reports.ts'
import { NIGHT_MUTED, REPORT } from '../palette.ts'
import { fractionOf, type Cursor } from './reading.ts'

/** An event on the ruler: where the arrows stop, and what they stop on. */
export type Dot = {
  at: Cursor
  /** In percent of the period, like a mark on a lane. */
  left: number
  color: string
}

/**
 * One dot per event, at its start, oldest first.
 *
 * The arrows jump to these very instants, so a dot is where a jump lands and a
 * jump never lands where no dot is. Held within the period for that reason: a
 * crossing begun before the replay would otherwise be a jump off the ruler.
 *
 * A report in the agents' green, a crossing in its threshold's colour. One
 * whose threshold has none is in the grey of the ruler's hours rather than in
 * the brand blue its lane gives it: on the ruler's night ground that blue is a
 * dot nobody sees, and an arrow stopping on it reads as a jump to nothing.
 */
export function dotsOf(events: readonly ReplayEvent[], period: TimeWindow): Dot[] {
  return events
    .map((event) => {
      const at = instantToRead(event, period)
      return { at, left: fractionOf(period, at) * 100, color: colourOf(event) }
    })
    .sort((one, other) => one.at - other.at)
}

function colourOf(event: ReplayEvent): string {
  if (event.origin === 'manual') return REPORT
  return event.color ?? NIGHT_MUTED
}
