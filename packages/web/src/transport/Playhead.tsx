import type { CSSProperties } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { fractionOf, type Cursor } from './reading.ts'

/**
 * The reading bar, and the only thing that moves with the cursor: its own
 * component, so that the lanes beside it are left alone.
 */
export function Playhead({ period, at }: { period: TimeWindow; at: Cursor }) {
  const style = { '--frac': fractionOf(period, at) } as CSSProperties
  return (
    <>
      <div className="playhead" style={style} />
      {/* Apart from the bar on a phone, where the bar passes under the ruler and its handle does not. */}
      <div className="playhead-handle" style={style} />
    </>
  )
}
