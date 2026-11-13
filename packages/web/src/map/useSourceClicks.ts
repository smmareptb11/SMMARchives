import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { useEffect } from 'react'

import { REPORT_AREAS, REPORT_SPOTS, shapeLayerOf } from './layers.ts'
import { clickedOf, reportUnder } from './reports.ts'
import { KINDS, sourceUnder } from './sources.ts'
import type { Detail } from './useWindows.ts'

/**
 * What the measuring sources and the reports answer to a click; the map itself
 * answers none.
 *
 * One handler asking what is under the pointer, since one per family would open
 * a detail for each family the click covers. Asked of the shapes and not of
 * their white rings, which are wider: clicking beside a gauge would open it.
 */
export function useSourceClicks(
  map: MapLibreMap | undefined,
  detail: Detail,
  onOpenReport: (id: string) => void,
  placing: boolean,
): void {
  useEffect(() => {
    // While the report form places an event, a click is a spot and opens nothing.
    if (map === undefined || placing) return

    const canvas = map.getCanvas()
    const layers = KINDS.map(shapeLayerOf)
    const clicked = (point: MapMouseEvent['point']) =>
      clickedOf({
        spot: reportUnder(map.queryRenderedFeatures(point, { layers: REPORT_SPOTS })),
        source: sourceUnder(map.queryRenderedFeatures(point, { layers })),
        area: reportUnder(map.queryRenderedFeatures(point, { layers: REPORT_AREAS })),
      })

    const onClick = (event: MapMouseEvent) => {
      const meant = clicked(event.point)
      if (meant === undefined) return
      if ('report' in meant) onOpenReport(meant.report)
      else detail.open({ kind: 'source', source: meant.source })
    }

    const pointer = pointerOver(map, clicked)
    map.on('click', onClick)
    map.on('mousemove', pointer.onMove)

    return () => {
      map.off('click', onClick)
      map.off('mousemove', pointer.onMove)
      pointer.stop()
      canvas.style.cursor = ''
    }
  }, [map, detail, onOpenReport, placing])
}

/**
 * The hand the pointer takes over something that answers a click.
 *
 * Asking what is underneath, since with a handler per family the gauge's leave
 * fires after the station's enter, and the pointer turns back to an arrow over a
 * marker. Once per frame at most, and never while the map moves: each question
 * walks every source drawn.
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
