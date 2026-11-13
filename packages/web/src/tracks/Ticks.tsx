import { memo } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import type { Dot } from '../transport/dots.ts'
import { ticksOf } from './ruler.ts'

/**
 * The ticks of the period and its events' dots, as the ruler draws them and the
 * transport's bar again. Memoised: that bar renders on every frame, and neither
 * moves with the reading.
 */
export const Ticks = memo(function Ticks({
  period,
  dots,
}: {
  period: TimeWindow
  dots: readonly Dot[]
}) {
  return (
    <>
      {ticksOf(period).map((tick) => (
        <span
          className={['tick', tick.odd ? 'odd' : '', tick.minor ? 'minor' : ''].join(' ').trim()}
          key={tick.at}
          style={{ left: `${String(tick.fraction * 100)}%` }}
        >
          <span>{tick.label}</span>
        </span>
      ))}
      {/* Keyed on their place, which their order keeps: two events can begin on one instant. */}
      {dots.map((dot, index) => (
        <i
          key={index}
          className="dot"
          style={{ left: `${String(dot.left)}%`, backgroundColor: dot.color }}
          aria-hidden="true"
        />
      ))}
    </>
  )
})
