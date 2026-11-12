import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import {
  advanced,
  atTheEnd,
  clamped,
  frameElapsed,
  nextMark,
  previousMark,
  resumes,
  startOf,
  stepped,
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
  /** A step of the keyboard later, or earlier. */
  forward: () => void
  back: () => void
  /**
   * Stops the reading while the cursor is dragged, and returns what lets it go
   * on: the reading resumes if it was playing when the drag began.
   */
  hold: () => () => void
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
      const elapsed = frameElapsed(now, last)
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
      // Held at once, not on the next render: a drag let go right after its
      // last move asks where the cursor stands before that render comes.
      held.current = clamped(period, cursor)
      setAt(held.current)
    },
    [period],
  )
  const hold = useHold(period, held, playing, setPlaying)
  const jumps = useJumps(period, marks, setAt)

  return { at, playing, speed, marks, setSpeed, play, pause, seek, hold, ...jumps }
}

/** The moves that land somewhere else than where the reading stands. */
function useJumps(
  period: TimeWindow,
  marks: readonly Cursor[],
  setAt: (move: (cursor: Cursor) => Cursor) => void,
): Pick<Reading, 'toNext' | 'toPrevious' | 'forward' | 'back'> {
  // Held within the period as a seek is: a mark is an event's start, and an
  // event can begin before the replay does.
  const toNext = useCallback(() => {
    setAt((cursor) => clamped(period, nextMark(marks, cursor) ?? cursor))
  }, [marks, period, setAt])
  const toPrevious = useCallback(() => {
    setAt((cursor) => clamped(period, previousMark(marks, cursor) ?? cursor))
  }, [marks, period, setAt])
  const forward = useCallback(() => {
    setAt((cursor) => stepped(period, cursor, 1))
  }, [period, setAt])
  const back = useCallback(() => {
    setAt((cursor) => stepped(period, cursor, -1))
  }, [period, setAt])
  return { toNext, toPrevious, forward, back }
}

/**
 * The reading held still for a drag, and let go again after it.
 *
 * Whether it was playing is read when the drag begins, which is not a render,
 * hence the ref; whether it goes on is `resumes`'s to say.
 */
function useHold(
  period: TimeWindow,
  held: RefObject<Cursor>,
  playing: boolean,
  setPlaying: (playing: boolean) => void,
): () => () => void {
  const running = useRef(playing)
  running.current = playing

  return useCallback(() => {
    const was = running.current
    setPlaying(false)
    return () => {
      if (resumes(was, period, held.current)) setPlaying(true)
    }
  }, [period, held, setPlaying])
}
