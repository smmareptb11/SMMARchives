import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { Ticks } from '../tracks/Ticks.tsx'
import type { Dot } from './dots.ts'
import { fractionOf, type Cursor } from './reading.ts'
import { useDrag } from './useDrag.ts'

/**
 * The whole period on one bar, where a phone seeks.
 *
 * The lanes' ruler is as wide as the lanes, which a phone scrolls across: this
 * bar fits the screen, so any instant is one drag away. Its ticks and dots are
 * the ruler's own, and its drag too. No `slider` role, for the ruler's reason:
 * the arrows `Transport` binds on the document would fall silent on a focus.
 */
export function Scrub({
  period,
  dots,
  at,
  onSeek,
  onHold,
}: {
  period: TimeWindow
  dots: readonly Dot[]
  at: Cursor
  onSeek: (fraction: number) => void
  onHold: () => () => void
}) {
  const drag = useDrag(onSeek, onHold)

  return (
    <div className="scrub" {...drag}>
      <Ticks period={period} dots={dots} />
      <i
        className="head"
        style={{ left: `${String(fractionOf(period, at) * 100)}%` }}
        aria-hidden="true"
      />
    </div>
  )
}
