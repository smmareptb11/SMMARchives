import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { useContext, useEffect, useMemo, useState } from 'react'

import type { Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { api } from '../api.ts'
import { webcamsWithoutPicture } from '../mutes.ts'
import { viewAt, type Views } from '../pictures.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { PointerContext, type Pointed } from './pointed.ts'
import type { Detail } from './useWindows.ts'
import type { Spot } from '../events/placing.ts'

type Framed = { camera: Webcam; element: HTMLElement; image: HTMLImageElement; marker: Marker }

/**
 * The cameras, as HTML markers where the rest of the map is a layer: each
 * carries an image no symbol layer can draw.
 */
export function WebcamMarkers({
  map,
  content,
  replayId,
  at,
  detail,
  selected,
  placing,
  onSpot,
  shown,
  mutesShown,
  views,
}: {
  map: MapLibreMap | undefined
  content: ReplayContent
  replayId: string
  at: Cursor
  detail: Detail
  /** The cameras whose details are open, which their frames say. */
  selected: ReadonlySet<string>
  /** The report form placing an event: a camera then opens nothing. */
  placing: boolean
  /** Where a click on a camera goes while the form places an event: its own spot. */
  onSpot: ((spot: Spot) => void) | undefined
  shown: boolean
  mutesShown: boolean
  views: Views
}) {
  const [framed, setFramed] = useState<Framed[]>([])

  // A marker per camera whatever the reader asked, which only decides which are
  // on the map: a toggle then never tears a marker down nor refetches its picture.
  const held = useMemo(
    () => (mutesShown ? new Set<string>() : webcamsWithoutPicture(content.webcams, views)),
    [mutesShown, content.webcams, views],
  )

  useEffect(() => {
    if (map === undefined) return
    const markers = content.webcams.map(framedOn)
    setFramed(markers)

    return () => {
      for (const one of markers) one.marker.remove()
      setFramed([])
    }
  }, [map, content.webcams])

  useDrawn(map, framed, shown, held)
  useClicks(framed, detail, { placing, onSpot })
  useSelected(framed, selected)
  usePointed(framed)
  usePictures({ framed, views, replayId, at, shown, held })

  return null
}

/**
 * The cameras the reader has not cut off, on the map, and no others; `held` are
 * those the replay froze no picture of. Off the map rather than `hidden`: the
 * frame's own `display` beats the browser's rule for that attribute.
 */
function useDrawn(
  map: MapLibreMap | undefined,
  framed: Framed[],
  shown: boolean,
  held: ReadonlySet<string>,
): void {
  useEffect(() => {
    if (map === undefined) return
    for (const { camera, marker } of framed) {
      if (shown && !held.has(camera.code)) marker.addTo(map)
      else marker.remove()
    }
  }, [map, framed, shown, held])
}

/**
 * What a camera answers to a click: its detail. Set apart from the marker, so a
 * new detail does not tear the markers down.
 */
function useClicks(
  framed: Framed[],
  detail: Detail,
  { placing, onSpot }: { placing: boolean; onSpot: ((spot: Spot) => void) | undefined },
): void {
  useEffect(() => {
    for (const { camera, element } of framed) {
      const activate = (event: Event) => {
        // Never let up to the map, whose click handler would open a report's
        // area under the marker too.
        event.stopPropagation()
        // Placing, the camera's own spot is the spot clicked.
        if (onSpot !== undefined) onSpot([camera.position.lon, camera.position.lat])
        else if (!placing) detail.open({ kind: 'camera', camera })
      }
      element.onclick = activate
      // A button's keys: the keyboard reaches the cameras through these alone.
      element.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        activate(event)
      }
    }
  }, [framed, detail, placing, onSpot])
}

/** The frame of the camera the pointer rests on in the lanes, lit up while it does. */
function usePointed(framed: Framed[]): void {
  const pointer = useContext(PointerContext)

  useEffect(() => {
    const light = (pointed: Pointed | undefined) => {
      for (const { camera, element } of framed) {
        element.classList.toggle(
          'pointed',
          pointed !== undefined && 'camera' in pointed && pointed.camera === camera.code,
        )
      }
    }
    light(pointer.get())
    return pointer.subscribe(light)
  }, [framed, pointer])
}

/** The frames of the cameras whose details are open, outlined as the mockup does. */
function useSelected(framed: Framed[], selected: ReadonlySet<string>): void {
  useEffect(() => {
    for (const { camera, element } of framed) {
      element.classList.toggle('selected', selected.has(camera.code))
    }
  }, [framed, selected])
}

/**
 * The view each camera was showing at the instant being read, and nothing for
 * a family cut off. Only where the picture changed: the same address assigned
 * again makes the browser drop the picture and fetch it anew.
 */
function usePictures({
  framed,
  views,
  replayId,
  at,
  shown,
  held,
}: {
  framed: Framed[]
  views: Views
  replayId: string
  at: Cursor
  shown: boolean
  held: ReadonlySet<string>
}): void {
  useEffect(() => {
    if (!shown) return

    for (const { camera, image } of framed) {
      if (held.has(camera.code)) continue
      const path = viewAt(views, camera.code, at)?.path
      const source = path === undefined ? undefined : api.mediaUrl(replayId, path)

      image.hidden = source === undefined
      if (source !== undefined && image.getAttribute('src') !== source) image.src = source
    }
  }, [framed, views, replayId, at, shown, held])
}

/**
 * A camera's marker, built off the map and empty until the cursor says what it
 * was showing. The picture sits inside the frame, so hiding it leaves the
 * camera's place on the map.
 */
function framedOn(camera: Webcam): Framed {
  const element = document.createElement('div')
  element.className = 'camera'
  // On the frame: the picture inside it comes and goes.
  element.tabIndex = 0
  element.setAttribute('role', 'button')
  element.setAttribute('aria-label', `Webcam de ${camera.commune}`)
  element.title = `Webcam de ${camera.commune}`

  const image = document.createElement('img')
  image.alt = ''
  image.hidden = true
  // Off the main thread: the picture changes on the frames the map repaints.
  image.decoding = 'async'
  element.append(image)

  return {
    camera,
    element,
    image,
    marker: new Marker({ element }).setLngLat([camera.position.lon, camera.position.lat]),
  }
}
