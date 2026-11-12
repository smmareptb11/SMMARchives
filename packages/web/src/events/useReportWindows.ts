import { useCallback, useEffect, useRef } from 'react'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import type { Detail } from '../map/useWindows.ts'
import { keyOf } from '../map/windows.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import type { Reading } from '../transport/useCursor.ts'
import { instantToRead } from './reports.ts'
import type { Panel } from './usePanel.ts'

/**
 * Opening a report's window, and bringing the reading to the event.
 *
 * Paused there, so the event stays under way on the map while it is read. From
 * the event itself once the form has saved it, as the content may not hold it
 * yet: which places the reading on an event whose time was just changed.
 *
 * By its name from the map, the lanes and the history — and not while the form
 * places an event, when a window would cover the spot to click. The events and
 * the placing are read through refs, so the lanes handed `openReport` are not
 * redrawn each time an event is saved or removed.
 *
 * The window of the event the form amends closes as the form opens: the form
 * says all the window said, and what it says is about to change.
 */
export function useReportWindows(
  content: ReplayContent,
  reading: Reading,
  { detail, panel, placing }: { detail: Detail; panel: Panel; placing: boolean },
) {
  const { pause, seek } = reading
  const { events, period } = content
  const held = useRef({ events, placing })
  useEffect(() => {
    held.current = { events, placing }
  }, [events, placing])

  const amended = panel?.kind === 'edit' ? panel.id : undefined
  useEffect(() => {
    if (amended !== undefined) detail.close(keyOf({ kind: 'report', id: amended }))
  }, [amended, detail])

  const openEvent = useCallback(
    (event: ReplayEvent) => {
      detail.open({ kind: 'report', id: event.id })
      pause()
      seek(instantToRead(event, period))
    },
    [detail, period, pause, seek],
  )
  const openReport = useCallback(
    (id: string) => {
      if (held.current.placing) return
      const event = held.current.events.find((one) => one.id === id)
      if (event !== undefined) openEvent(event)
    },
    [openEvent],
  )
  return { openReport, openEvent }
}
