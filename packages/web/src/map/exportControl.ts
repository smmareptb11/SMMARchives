import type { IControl, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import { downloadCanvasPng, mapExportName } from '../download.ts'
import type { Cursor } from '../transport/reading.ts'

/** What the basemap's licence asks of any image made from it. */
const CREDIT = '© OpenFreeMap © OpenStreetMap'

/** The basemap's own source, absent from the blank ground a map falls back on. */
const BASEMAP_SOURCE = 'openmaptiles'

/**
 * Saves the map as a PNG, as the Acycliq widget saves a chart: what the map
 * draws, not the legend, windows or thumbnails laid over it. The name is asked on
 * each use, since the instant read moves between two clicks.
 */
function exportControl(name: () => string): IControl {
  const container = document.createElement('div')
  container.className = 'maplibregl-ctrl maplibregl-ctrl-group export'
  const button = document.createElement('button')
  button.type = 'button'
  button.title = 'Télécharger la carte en image PNG'
  button.setAttribute('aria-label', button.title)
  const icon = document.createElement('span')
  icon.className = 'maplibregl-ctrl-icon'
  icon.setAttribute('aria-hidden', 'true')
  button.append(icon)
  container.append(button)

  return {
    onAdd(map) {
      button.onclick = () => {
        save(map, name())
      }
      return container
    },
    onRemove() {
      container.remove()
    },
  }
}

/**
 * Read on the frame drawn next: WebGL clears what it drew once the frame is on
 * screen, and keeping every frame for the rare one saved would slow them all.
 */
function save(map: MapLibreMap, filename: string): void {
  map.once('render', () => {
    const canvas = map.getCanvas()
    const scale = canvas.width / canvas.clientWidth
    const credited = map.getSource(BASEMAP_SOURCE) !== undefined
    downloadCanvasPng(canvas, filename, credited ? { credit: CREDIT, scale } : { scale })
  })
  map.triggerRepaint()
}

/**
 * The way to save the map as an image, beside the zoom, once there is a map.
 * Named on the click, or the control would be rebuilt on every tick.
 */
export function useExported(map: MapLibreMap | undefined, label: string | null, at: Cursor): void {
  const naming = useRef(() => mapExportName(label, at))
  naming.current = () => mapExportName(label, at)

  useEffect(() => {
    if (map === undefined) return
    const control = exportControl(() => naming.current())
    map.addControl(control, 'bottom-right')
    return () => {
      map.removeControl(control)
    }
  }, [map])
}
