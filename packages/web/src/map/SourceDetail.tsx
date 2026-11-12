import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useState } from 'react'

import type { Views } from '../pictures.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import type { Shown } from './families.ts'
import { selectSource } from './layers.ts'
import { useSourceClicks } from './useSourceClicks.ts'
import type { Detail } from './useWindows.ts'
import type { Asked } from './frame.ts'
import { WebcamMarkers } from './WebcamMarkers.tsx'
import type { DrawnSource } from './sources.ts'
import type { Window } from './windows.ts'
import type { Spot } from '../events/placing.ts'

/** The detail a card of the history or a lane asks for, from outside the map. */
function useAsked(asked: Asked | undefined, detail: Detail): void {
  useEffect(() => {
    const opens = asked?.opens
    if (opens !== undefined) detail.open(opens)
  }, [asked, detail])
}

export type SourceDetailProps = {
  map: MapLibreMap | undefined
  content: ReplayContent
  replayId: string
  at: Cursor
  shown: Shown
  mutesShown: boolean
  /** Opens what an agent reported, from the diamond or the area that stands for it. */
  onOpenReport: (id: string) => void
  /** The report form placing an event: a click on a source then opens nothing. */
  placing: boolean
  /** Where a click goes while the form places an event, a camera's included. */
  onSpot: ((spot: Spot) => void) | undefined
  /** A station whose detail is asked for from outside the map. */
  asked: Asked | undefined
  views: Views
  detail: Detail
  windows: readonly Window[]
}

/**
 * What a click on a source opens — its window — and the outline on the map
 * that says which source it is, for every source open at once.
 *
 * The cameras are here too, being markers that answer a click of their own,
 * where every other source answers through the map's.
 */
export function SourceDetail({
  map,
  content,
  replayId,
  at,
  shown,
  mutesShown,
  onOpenReport,
  placing,
  onSpot,
  asked,
  views,
  detail,
  windows,
}: SourceDetailProps) {
  useSourceClicks(map, detail, onOpenReport, placing)
  useAsked(asked, detail)
  const { sources, cameras } = useSelected(windows)

  // The outlines follow what the reader shows, and leave with the windows.
  useEffect(() => {
    if (map !== undefined) selectSource(map, sources, shown, mutesShown)
  }, [map, sources, shown, mutesShown])

  return (
    <WebcamMarkers
      {...{ map, content, replayId, at, detail, placing, onSpot }}
      selected={cameras}
      shown={shown.webcam}
      mutesShown={mutesShown}
      views={views}
    />
  )
}

/**
 * The sources and the cameras the open windows are about, the same until one
 * opens or closes.
 *
 * Not on every new list of windows: a window brought forward is one, and each
 * would set a filter on every layer of the map and touch every camera's frame
 * for the same outlines. Adjusted while rendering, as `usePlacing` is.
 */
function useSelected(windows: readonly Window[]) {
  const keys = windows.map((one) => one.key).join(' ')
  const [held, setHeld] = useState(() => ({ keys, selected: selectedIn(windows) }))
  if (held.keys !== keys) {
    const next = { keys, selected: selectedIn(windows) }
    setHeld(next)
    return next.selected
  }
  return held.selected
}

function selectedIn(windows: readonly Window[]): {
  sources: DrawnSource[]
  cameras: ReadonlySet<string>
} {
  const sources: DrawnSource[] = []
  const cameras = new Set<string>()
  for (const { subject } of windows) {
    if (subject.kind === 'source') sources.push(subject.source)
    if (subject.kind === 'camera') cameras.add(subject.camera.code)
  }
  return { sources, cameras }
}
