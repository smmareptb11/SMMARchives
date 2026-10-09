import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useState } from 'react'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { phaseAt, writtenIn } from '../events/span.ts'
import type { Writing } from '../events/useWriting.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { diamond, usePicking, usePin } from './usePicking.ts'

/**
 * Everything the map does for events an agent writes: the ones placed, the
 * place being picked for the next, and the pin it leaves before it is stored.
 */
export function WrittenOnMap({
  map,
  content,
  at,
  shown,
  writing,
}: {
  map: MapLibreMap | undefined
  content: ReplayContent
  at: Cursor
  shown: boolean
  writing: Writing
}) {
  usePicking(map, writing.picking, writing.placed)
  usePin(map, writing.writing ? writing.position : null)

  return (
    <WrittenEventMarkers
      map={map}
      events={content.events}
      at={at}
      shown={shown}
      onOpen={writing.open}
    />
  )
}

type Placed = { event: ReplayEvent; element: HTMLElement; marker: Marker }

/**
 * The events an agent placed, as HTML markers, from the moment they happen.
 *
 * Markers rather than a layer, as the cameras are: a handful of them, each
 * answering a click with a sheet rather than a bubble. Kept once past, and
 * dimmed: a road cut in the morning is still a fact of the afternoon.
 */
function WrittenEventMarkers({
  map,
  events,
  at,
  shown,
  onOpen,
}: {
  map: MapLibreMap | undefined
  events: readonly ReplayEvent[]
  at: Cursor
  shown: boolean
  onOpen: (id: string) => void
}) {
  const [placed, setPlaced] = useState<Placed[]>([])
  const written = useMemo(() => writtenIn(events), [events])

  useEffect(() => {
    if (map === undefined) return
    const markers = written.flatMap(placedOn)
    setPlaced(markers)

    return () => {
      for (const one of markers) one.marker.remove()
      setPlaced([])
    }
  }, [map, written])

  useEffect(() => {
    for (const { event, element } of placed) {
      element.onclick = (click) => {
        // Never let up to the map, whose own handler closes the bubble and, in
        // picking, would take the click for a place.
        click.stopPropagation()
        onOpen(event.id)
      }
    }
  }, [placed, onOpen])

  // On every tick, so a marker is touched only when its phase moves:
  // `addTo` takes a marker off and puts it back, even one already there.
  useEffect(() => {
    if (map === undefined) return
    for (const { event, element, marker } of placed) {
      const phase = phaseAt(event, at)
      const drawn = shown && phase !== 'ahead'

      if (drawn && !element.isConnected) marker.addTo(map)
      if (!drawn && element.isConnected) marker.remove()
      element.classList.toggle('past', phase === 'past')
    }
  }, [map, placed, at, shown])

  return null
}

/** A marker for an event that has a place, and none for one that has not. */
function placedOn(event: ReplayEvent): Placed[] {
  if (event.position === null) return []

  const element = diamond('written-event')
  const shape = element.firstElementChild as HTMLElement
  shape.title = event.title
  shape.setAttribute('aria-label', event.title)

  return [
    {
      event,
      element,
      marker: new Marker({ element }).setLngLat([event.position.lon, event.position.lat]),
    },
  ]
}
