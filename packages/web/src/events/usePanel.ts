import { useCallback, useMemo, useRef, useState } from 'react'

import type { Instant } from '@smmarchives/shared/clock.ts'

/** What the right-hand column holds of the events: the form to report or amend one, or nothing. */
export type Panel = { kind: 'form'; at: Instant } | { kind: 'edit'; id: string } | undefined

export type PanelControl = {
  panel: Panel
  /** Asks for another panel; held while the form holds what the agent typed. */
  request: (next: Panel) => void
  /** Shows a panel whatever the form held: what it held has just been saved. */
  show: (next: Panel) => void
  close: () => void
  /** Something is waiting to replace a form the agent has typed into. */
  leaving: boolean
  leave: () => void
  stay: () => void
  setTouched: (touched: boolean) => void
}

/**
 * The form open in the right-hand column, which nothing replaces without asking
 * once the agent has typed into it. The callbacks read the state through refs,
 * so they keep their identity.
 */
export function usePanel(): PanelControl {
  const [panel, setPanel] = useState<Panel>(undefined)
  const [waiting, setWaiting] = useState<{ next: Panel } | undefined>(undefined)
  const shown = useRef<Panel>(undefined)
  const touched = useRef(false)

  const show = useCallback((next: Panel) => {
    shown.current = next
    touched.current = false
    setWaiting(undefined)
    setPanel(next)
  }, [])

  const request = useCallback(
    (next: Panel) => {
      if (shown.current !== undefined && touched.current) setWaiting({ next })
      else show(next)
    },
    [show],
  )

  const setTouched = useCallback((one: boolean) => {
    touched.current = one
  }, [])

  return useMemo(
    () => ({
      panel,
      request,
      show,
      close: () => {
        request(undefined)
      },
      leaving: waiting !== undefined,
      leave: () => {
        show(waiting?.next)
      },
      stay: () => {
        setWaiting(undefined)
      },
      setTouched,
    }),
    [panel, request, show, waiting, setTouched],
  )
}

/**
 * Which form a panel holds, as React tells one from another: an amended event is
 * its own form, so nothing typed carries over; a new one is its instant's, so it
 * starts where the reading stands.
 */
export function formKeyOf(at: Instant, editing: { id: string } | undefined): string {
  return editing === undefined ? `new-${at}` : `edit-${editing.id}`
}
