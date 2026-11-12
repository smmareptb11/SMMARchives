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
 * The cameras, as HTML markers where the rest of the map is a layer.
 *
 * Five of them, and each carries an image no symbol layer can draw. The three
 * hundred measuring sources take the other road for the opposite reason: they
 * are three hundred, and a layer draws them in one call.
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

  // A marker per camera whatever the reader asked, and the asking decides which
  // are put on the map: a camera cut off keeps its frame, so a toggle costs a
  // marker moved rather than five torn down and their pictures fetched again.
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
 * The cameras the reader has not cut off, on the map, and no others.
 *
 * Put on the map here and nowhere else, which is also what cuts a family off:
 * a marker's frame carries a `display`, which beats the browser's own rule for
 * the `hidden` attribute and would leave a cut family drawn.
 *
 * `held` are the cameras the replay froze no picture of, which are off the map
 * until the reader asks for them — the same answer the measuring sources get
 * through the filter on their layers.
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
 * What a camera answers to a click: its detail.
 *
 * Set here rather than when the marker is built, so that a detail replaced
 * between two replays does not cost five markers torn down and drawn again.
 */
function useClicks(
  framed: Framed[],
  detail: Detail,
  { placing, onSpot }: { placing: boolean; onSpot: ((spot: Spot) => void) | undefined },
): void {
  useEffect(() => {
    for (const { camera, element } of framed) {
      const activate = (event: Event) => {
        // Never let up to the map: a marker sits inside the map's own
        // container, and the map's click handler would look for a measuring
        // source under it — a report's area, there, would open its sheet too.
        event.stopPropagation()
        // Placing, the camera's spot is the spot clicked: where a camera
        // stands is a likely place for what it watched.
        if (onSpot !== undefined) onSpot([camera.position.lon, camera.position.lat])
        else if (!placing) detail.open({ kind: 'camera', camera })
      }
      element.onclick = activate
      // A button's keys, for a marker that is one: the map reaches its
      // stations through the lanes, and its cameras through these alone.
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
 * The view each camera was showing at the instant being read.
 *
 * Only where the picture actually changed: the reading advances sixty times a
 * second, and reassigning the same address makes the browser drop the picture
 * and fetch it again. And nothing at all for a family the reader cut off, which
 * would otherwise go on fetching pictures nobody is shown.
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
 * A camera's marker, empty until the cursor says what it was showing.
 *
 * The frame is the marker and the picture is inside it, so hiding the picture
 * leaves the camera's place on the map. Built off the map, and put on it by
 * whoever knows whether the reader wants it drawn.
 */
function framedOn(camera: Webcam): Framed {
  const element = document.createElement('div')
  element.className = 'camera'
  // On the frame, which is what the keyboard reaches and what a press opens;
  // the picture inside it, which comes and goes, names nothing of its own.
  element.tabIndex = 0
  element.setAttribute('role', 'button')
  element.setAttribute('aria-label', `Webcam de ${camera.commune}`)
  element.title = `Webcam de ${camera.commune}`

  const image = document.createElement('img')
  image.alt = ''
  image.hidden = true
  // Off the main thread: the picture changes while the reading runs, and the
  // map is repainting its three hundred sources on the same frames.
  image.decoding = 'async'
  element.append(image)

  return {
    camera,
    element,
    image,
    marker: new Marker({ element }).setLngLat([camera.position.lon, camera.position.lat]),
  }
}
