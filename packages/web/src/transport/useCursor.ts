import { useCallback, useEffect, useRef, useState } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import {
  advanced,
  atTheEnd,
  clamped,
  nextMark,
  previousMark,
  startOf,
  type Cursor,
  type Speed,
} from './reading.ts'

export type Reading = {
  at: Cursor
  playing: boolean
  speed: Speed
  play: () => void
  pause: () => void
  setSpeed: (speed: Speed) => void
  seek: (cursor: Cursor) => void
  toNext: () => void
  toPrevious: () => void
  /** Where the cursor can jump to, so a button with nowhere to go is disabled. */
  marks: readonly Cursor[]
}

/**
 * The reading of a replay, and what moves it.
 *
 * The loop advances by the time actually elapsed and never by a fixed step: a
 * frame the browser skipped must not slow the replay down, or the same episode
 * tells a different story on a busy machine than on an idle one.
 */
export function useCursor(period: TimeWindow, marks: readonly Cursor[]): Reading {
  const [at, setAt] = useState(() => startOf(period))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(5)

  // The loop reads the cursor here rather than through the setter's updater:
  // React reserves the right to replay an updater, and stopping the reading
  // from inside one would be a decision taken twice.
  const held = useRef(at)
  held.current = at

  useEffect(() => {
    if (!playing) return

    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = now - last
      last = now

      const next = advanced(period, held.current, elapsed, speed)
      held.current = next
      setAt(next)
      if (atTheEnd(period, next)) setPlaying(false)

      frame = requestAnimationFrame(tick)
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [playing, speed, period])

  // Stable, every one of them: a keyboard listener bound to the document and a
  // memoised list of lanes both take these as dependencies, and a new function
  // on every tick would rebind the one and rebuild the other sixty times a
  // second.
  const play = useCallback(() => {
    // Playing from the end would advance nothing and leave the button pressed.
    setPlaying(!atTheEnd(period, held.current))
  }, [period])
  const pause = useCallback(() => {
    setPlaying(false)
  }, [])
  const seek = useCallback(
    (cursor: Cursor) => {
      setAt(clamped(period, cursor))
    },
    [period],
  )
  const toNext = useCallback(() => {
    setAt((cursor) => nextMark(marks, cursor) ?? cursor)
  }, [marks])
  const toPrevious = useCallback(() => {
    setAt((cursor) => previousMark(marks, cursor) ?? cursor)
  }, [marks])

  return { at, playing, speed, marks, setSpeed, play, pause, seek, toNext, toPrevious }
}
