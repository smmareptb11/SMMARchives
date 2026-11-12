import { useCallback, useEffect, useMemo, useState } from 'react'

import { closing, opening, raising, type Subject, type Window } from './windows.ts'

/** Opening a window, bringing one forward, and closing one. */
export type Detail = {
  open: (subject: Subject) => void
  raise: (key: string) => void
  close: (key: string) => void
}

/**
 * The windows open over the map — sources' details and reports' sheets — as
 * many as the reader opened.
 *
 * Windows rather than bubbles on the markers: a bubble carrying a curve is
 * taller than the room a source near the edge leaves it, and opened downwards
 * it slid under the montage. The marker says which sources are open instead.
 *
 * Closed one by one from the window itself — its cross, or Escape — and never
 * by a click elsewhere: what the reader set out to compare stays until they put
 * it away.
 *
 * The three are returned apart from what is open, so that a click handler
 * taking them as a dependency is not rebound every time a window opens or
 * closes.
 */
export function useWindows(
  replayId: string,
  placing: boolean,
): { detail: Detail; windows: readonly Window[] } {
  const [windows, setWindows] = useState<readonly Window[]>([])

  // Nothing survives the replay it speaks of: a window kept across replays
  // would ask the new one for a value under the name of a station of the old.
  useEffect(
    () => () => {
      setWindows([])
    },
    [replayId],
  )

  // Placing starts on the agent's word, and a window left open would hide the
  // spot to click.
  useEffect(() => {
    if (placing) setWindows([])
  }, [placing])

  const open = useCallback<Detail['open']>((subject) => {
    setWindows((now) => opening(now, subject))
  }, [])
  const raise = useCallback<Detail['raise']>((key) => {
    setWindows((now) => raising(now, key))
  }, [])
  const close = useCallback<Detail['close']>((key) => {
    setWindows((now) => closing(now, key))
  }, [])

  return { detail: useMemo(() => ({ open, raise, close }), [open, raise, close]), windows }
}
