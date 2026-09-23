import type { CSSProperties } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { fractionOf, type Cursor } from './reading.ts'

/**
 * The reading bar, and the only thing that moves with the cursor.
 *
 * Its own component so the lanes beside it are left alone: they are rebuilt
 * from three hundred sources, and nothing in them changes as the bar advances.
 * Its position is a fraction of the period on a CSS variable — the bar knows
 * dates, never pixels, exactly like a mark on a lane.
 */
export function Playhead({ period, at }: { period: TimeWindow; at: Cursor }) {
  return <div className="playhead" style={{ '--frac': fractionOf(period, at) } as CSSProperties} />
}
