import { Popup, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import { CURVE_WIDTH } from '../detail/chart.ts'
import type { Subject } from './CalloutView.tsx'
import { shapeLayerOf } from './layers.ts'
import { KINDS, sourceUnder } from './sources.ts'

/** How far the bubble keeps from its anchor, so it does not cover it. */
const OFFSET = 14

/**
 * How wide the bubble is allowed to grow.
 *
 * The width of a station's curve plus what MapLibre pads a bubble with, and in
 * the unit the curve is drawn in: narrower, a canvas of fixed pixels would
 * stick out of the bubble the day a reader sets a smaller default font; wider,
 * the lines of text would run on past the drawing and leave it ragged.
 */
const WIDEST = `${String(CURVE_WIDTH + 20)}px`

/** What is open, and where React renders its content. */
export type Open = { subject: Subject; container: HTMLElement; popup: Popup }

/** Opening the one bubble of the map on a place, and closing it. */
export type Bubble = {
  open: (lngLat: [number, number], subject: Subject) => void
  close: () => void
}

/**
 * One bubble at a time, and the element React renders its content into.
 *
 * The content is React's rather than nodes built here: what a bubble carries
 * changes with the reading, and one part of it — the chart of a station — cannot
 * be thrown away and rebuilt sixty times a second.
 *
 * Opening and closing both live here. MapLibre offers to close a bubble on any
 * click on the map, and that offer is refused: a marker carrying its own click
 * handler would then have its bubble closed by the very click that opened it.
 *
 * The two are returned apart from what is open, so that a click handler taking
 * them as a dependency is not rebound every time a bubble opens or closes.
 */
export function useCallout(
  map: MapLibreMap | undefined,
  replayId: string,
): { bubble: Bubble; shown: Open | undefined } {
  const [shown, setShown] = useState<Open | undefined>(undefined)

  const close = useCallback(() => {
    setShown(undefined)
  }, [])

  // The bubble follows the state: opening another one, closing, or leaving the
  // map removes the one before it. Nothing survives the replay it speaks of
  // either — a bubble kept across replays would ask the new one for a value
  // under the name of a station of the old.
  useEffect(() => {
    if (shown === undefined) return

    return () => {
      shown.popup.remove()
    }
  }, [shown])
  useEffect(() => close, [map, replayId, close])

  // Added to the map once React has filled the container, and never before:
  // MapLibre chooses which side of the marker to open on by measuring the
  // content, and an empty box opens a full bubble upwards, off the map. What a
  // station says is the same height from that first render on — the room its
  // curve takes is held while the measures are read — so the side chosen here
  // is the side it keeps.
  useLayoutEffect(() => {
    if (map !== undefined && shown !== undefined) shown.popup.addTo(map)
  }, [map, shown])

  const open = useCallback<Bubble['open']>(
    (lngLat, subject) => {
      if (map === undefined) return

      const container = document.createElement('div')
      container.className = 'callout'
      const popup = new Popup({
        offset: OFFSET,
        closeButton: false,
        closeOnClick: false,
        maxWidth: WIDEST,
      })
        .setLngLat(lngLat)
        .setDOMContent(container)

      // A bubble the map closes on its own — the map being removed — takes the
      // state with it, or React would keep rendering into a container nobody
      // sees.
      popup.once('close', () => {
        setShown(undefined)
      })

      setShown({ subject, container, popup })
    },
    [map],
  )

  return { bubble: useMemo(() => ({ open, close }), [open, close]), shown }
}

/**
 * What the measuring sources answer to a click, and what the map answers.
 *
 * One handler asking what is under the pointer, rather than one per family: a
 * handler per family fires once per family the click covers, and the last one
 * to answer would replace the bubble the first had opened.
 *
 * On the shapes and not on their white rings: a ring is wider than the shape it
 * backs, and clicking beside a rain gauge would open the rain gauge.
 */
export function useSourceClicks(
  map: MapLibreMap | undefined,
  bubble: Bubble,
  picking: boolean,
): void {
  useEffect(() => {
    // A click while a place is being picked is that place, and nothing else.
    if (map === undefined || picking) return

    const canvas = map.getCanvas()
    const layers = KINDS.map(shapeLayerOf)
    const under = (point: MapMouseEvent['point']) =>
      sourceUnder(map.queryRenderedFeatures(point, { layers }))

    const onClick = (event: MapMouseEvent) => {
      const source = under(event.point)
      if (source === undefined) return bubble.close()

      // The bubble on the source rather than on the point clicked, or its tip
      // lands beside the marker and names none of the ones around it.
      bubble.open(source.at, { kind: 'source', source })
    }

    const pointer = pointerOver(map, under)
    map.on('click', onClick)
    map.on('mousemove', pointer.onMove)

    return () => {
      map.off('click', onClick)
      map.off('mousemove', pointer.onMove)
      pointer.stop()
      canvas.style.cursor = ''
    }
  }, [map, bubble, picking])
}

/**
 * The hand the pointer takes over something that answers a click.
 *
 * Asking what is underneath, rather than one handler per family: sliding from a
 * rain gauge onto a station fires the gauge's leave after the station's enter,
 * and the pointer would go back to an arrow over a marker.
 *
 * Once per frame at most, and never while the map is moving: MapLibre passes
 * every pointer sample through, and asking what is under the pointer walks the
 * three hundred sources drawn — on the frames the map is already repainting.
 */
function pointerOver(
  map: MapLibreMap,
  under: (point: MapMouseEvent['point']) => unknown,
): { onMove: (event: MapMouseEvent) => void; stop: () => void } {
  const canvas = map.getCanvas()
  let frame: number | undefined

  return {
    onMove: (event) => {
      if (frame !== undefined || map.isMoving()) return
      const { point } = event

      frame = requestAnimationFrame(() => {
        frame = undefined
        const cursor = under(point) === undefined ? '' : 'pointer'
        if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor
      })
    },
    stop: () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
    },
  }
}
