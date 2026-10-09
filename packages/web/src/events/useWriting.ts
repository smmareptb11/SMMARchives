import { useCallback, useState } from 'react'

import type { Position } from '@smmarchives/shared/contracts/geometry.ts'

/**
 * Writing an event and reading one, which share the room over the map.
 *
 * One at a time: the form takes the place of a sheet, and an event just added
 * opens in the sheet the form leaves. The callbacks are stable, because the
 * lanes are memoised and take one of them.
 *
 * Neither can be shown before the map is: both float on it, and the map is
 * loaded apart from the screen. Until it says it is ready, nothing offers to
 * write or to open an event, rather than offering what would show nothing.
 */
export function useWriting() {
  const [writing, setWriting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const [opened, setOpened] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [ready, setReady] = useState(false)

  // Forgets a sheet asked for while the form held the room, too: opened on
  // the way out, it would answer a click made a while ago, unasked.
  const ended = useCallback(() => {
    setWriting(false)
    setPicking(false)
    setPosition(null)
    setOpened(undefined)
  }, [])

  return {
    ready,
    onReady: setReady,
    writing,
    picking,
    position,
    opened,
    notice,
    start: useCallback(() => {
      setOpened(undefined)
      setWriting(true)
    }, []),
    pick: setPicking,
    placed: useCallback((at: Position) => {
      setPosition(at)
      setPicking(false)
    }, []),
    unplace: useCallback(() => setPosition(null), []),
    cancel: ended,
    added: useCallback(
      (id: string, said: string | undefined) => {
        ended()
        setOpened(id)
        setNotice(said)
      },
      [ended],
    ),
    open: useCallback((id: string) => {
      setOpened(id)
      setNotice(undefined)
    }, []),
    close: useCallback(() => setOpened(undefined), []),
  }
}

export type Writing = ReturnType<typeof useWriting>
