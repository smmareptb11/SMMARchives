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
 * One dot per event, at its start, oldest first: where the arrows land, and held
 * within the period as they are.
 *
 * A crossing whose threshold has no colour is in the grey of the ruler's hours,
 * not in its lane's blue, which the ruler's night ground would hide.
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
