import { useCallback, useMemo, useRef, useState } from 'react'

import type { Instant } from '@smmarchives/shared/clock.ts'

/** What the left-hand panel shows: an event's sheet, the form, or nothing. */
export type Panel = { kind: 'sheet'; id: string } | { kind: 'form'; at: Instant } | undefined

export type PanelControl = {
  panel: Panel
  /** Asks for another panel; held while the form holds what the agent typed. */
  request: (next: Panel) => void
  openReport: (id: string) => void
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
 * The one panel on the left, and the question before a form is thrown away.
 *
 * Nothing replaces a form the agent has typed into without asking: a click on
 * a mark of the lanes, meant to look something up, would otherwise cost them
 * what they were writing. The callbacks read the state through refs, so they
 * keep their identity and the lanes they are handed to are not redrawn.
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
      if (shown.current?.kind === 'form' && touched.current) setWaiting({ next })
      else show(next)
    },
    [show],
  )

  const openReport = useCallback(
    (id: string) => {
      request({ kind: 'sheet', id })
    },
    [request],
  )

  const setTouched = useCallback((one: boolean) => {
    touched.current = one
  }, [])

  return useMemo(
    () => ({
      panel,
      request,
      openReport,
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
    [panel, request, openReport, show, waiting, setTouched],
  )
}
