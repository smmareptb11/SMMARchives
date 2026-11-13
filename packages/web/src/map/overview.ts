import type { IControl, Map as MapLibreMap } from 'maplibre-gl'

import { PHONE } from '../phone.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import type { Rect } from './framing.ts'
import { openingOf, seesAll } from './sources.ts'

type Opening = ReturnType<typeof openingOf>

/**
 * Where the map opens on a replay, at the size it has now, and clear of the
 * legend as it stands now: folded, it gives its room back.
 */
export function openingOn(map: MapLibreMap, content: ReplayContent): Opening {
  const container = map.getContainer()
  const size = { width: container.clientWidth, height: container.clientHeight }
  return openingOf(content, size, matchMedia(PHONE).matches, legendOver(container))
}

/**
 * The legend's rectangle, in pixels of the map. Read off the page: it is laid
 * over the map by the stylesheet, and its size is the one its content gives it.
 */
function legendOver(container: HTMLElement): Rect | undefined {
  const legend = container.closest('.replay-map')?.querySelector('.map-legend')
  if (legend == null) return undefined
  const map = container.getBoundingClientRect()
  const over = legend.getBoundingClientRect()
  return {
    left: over.left - map.left,
    top: over.top - map.top,
    right: over.right - map.left,
    bottom: over.bottom - map.top,
  }
}

/**
 * The way back to the view the map opened on, beside the zoom, shown once the
 * view no longer holds every source it opened on. The opening is asked again on
 * each use, for the map's size of the moment.
 */
export function overviewControl(opening: () => Opening): IControl {
  const container = document.createElement('div')
  container.className = 'maplibregl-ctrl maplibregl-ctrl-group overview'
  const button = document.createElement('button')
  button.type = 'button'
  button.title = 'Revenir à la vue d’ensemble'
  button.setAttribute('aria-label', button.title)
  const icon = document.createElement('span')
  icon.className = 'maplibregl-ctrl-icon'
  icon.setAttribute('aria-hidden', 'true')
  button.append(icon)
  container.append(button)

  let held: MapLibreMap | undefined
  const update = () => {
    const now = opening()
    if (held === undefined || now === undefined) return
    const view = held.getBounds()
    container.hidden = seesAll(
      {
        west: view.getWest(),
        south: view.getSouth(),
        east: view.getEast(),
        north: view.getNorth(),
      },
      now.bounds,
    )
  }

  return {
    onAdd(map) {
      held = map
      button.onclick = () => {
        const now = opening()
        if (now !== undefined) map.fitBounds(now.bounds, { padding: now.padding })
      }
      map.on('moveend', update)
      update()
      return container
    },
    onRemove() {
      held?.off('moveend', update)
      held = undefined
      container.remove()
    },
  }
}
