import { useCallback, useState } from 'react'

import type { HistoryEntry } from './events/history.ts'
import type { Placement } from './events/placing.ts'
import { instantToRead } from './events/reports.ts'
import { crossingSource, frameOf, laneAsked, type Asked, type Named } from './map/frame.ts'
import type { Reading } from './transport/useCursor.ts'
import type { ReplayContent } from './tracks/lanes.ts'
import type { View } from './ViewSwitch.tsx'

/**
 * What the right-hand column and the map pass each other: the place the form
 * puts an event on, where a card of the history sends the map, and on a phone
 * which of the two is on screen. A crossing also opens its station's detail and
 * holds the reading on its start, as a report's window holds it on the event.
 */
export function useBetweenColumnAndMap(content: ReplayContent, reading: Reading) {
  const [placement, setPlacement] = useState<Placement | undefined>(undefined)
  const [asked, setAsked] = useState<Asked | undefined>(undefined)
  const [view, setView] = useState<View>('map')
  const { pause, seek } = reading
  const { events, stations, period } = content
  const onShow = useCallback(
    (entry: HistoryEntry) => {
      const event = events.find((one) => one.id === entry.id)
      if (event === undefined) return
      const frame = frameOf(event, stations)
      if (entry.kind === 'report') return setAsked({ opens: undefined, frame })
      pause()
      seek(instantToRead(event, period))
      const source = crossingSource(stations, entry.sourceId)
      setAsked({ opens: source === undefined ? undefined : { kind: 'source', source }, frame })
    },
    [events, stations, period, pause, seek],
  )
  // A lane's source or camera has no instant of its own: the reading stays where it is.
  const onOpenLane = useCallback(
    (named: Named) => {
      const laned = laneAsked(content, named)
      if (laned !== undefined) setAsked(laned)
    },
    [content],
  )
  return {
    placement,
    setPlacement,
    asked,
    onShow,
    onOpenLane,
    shown: { view, onView: setView },
  }
}
