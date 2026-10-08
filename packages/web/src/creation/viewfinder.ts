import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import { Map as MapLibreMap, NavigationControl, type StyleSpecification } from 'maplibre-gl'
import type { RefObject } from 'react'

import { cornersOf, extentBetween, FRAME, paddingOf, reachOf, type Size } from './extent.ts'

/**
 * The map and whether a rectangle narrows it.
 *
 * Not narrowed is the whole territory, which has no rectangle: a replay of the
 * whole fleet sends no extent, and a rectangle would drop the sources that have
 * no position.
 */
export type Picker = {
  map: MapLibreMap
  narrowed: boolean
  framed: (extent: BoundingBox | null) => void
  moving: (moving: boolean) => void
}

/** The whole fleet, on a map smaller than a replay's, hence a centre and zoom of its own. */
const OPENING = { center: [2.55, 43.0] as [number, number], zoom: 7.3 }

export function pickerOn(
  map: MapLibreMap,
  change: RefObject<(extent: BoundingBox | null) => void>,
  move: RefObject<(moving: boolean) => void>,
): Picker {
  return {
    map,
    narrowed: false,
    framed: (extent) => change.current(extent),
    moving: (moving) => move.current(moving),
  }
}

/**
 * A map that stays north up, flat, and no wider than the territory.
 *
 * The extent is read off two corners of the screen: turned or tilted, the map
 * would send a box wider than the rectangle drawn over it. Zooming out past the
 * opening view, or moving further off it than the frame needs to reach its
 * edges, would only show ground holding nothing to replay.
 */
export function basinMap(container: HTMLElement, style: string | StyleSpecification): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style,
    attributionControl: { compact: true },
    ...OPENING,
    minZoom: OPENING.zoom,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
  })
  const reach = reachOf(FRAME, sizeOf(map))
  map.setMaxBounds([
    map.unproject([reach.southWest.x, reach.southWest.y]),
    map.unproject([reach.northEast.x, reach.northEast.y]),
  ])
  map.touchZoomRotate.disableRotation()
  map.keyboard.disableRotation()
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
  return map
}

/**
 * Tells the form what the rectangle frames once the map comes to rest: the
 * form only needs the extent to send it.
 *
 * Until then, the form holds the extent framed before the move, so it also
 * hears that a narrowed map is moving.
 */
export function listen(picker: Picker): void {
  picker.map.on('movestart', () => {
    if (picker.narrowed) picker.moving(true)
  })
  picker.map.on('moveend', () => {
    picker.moving(false)
    if (picker.narrowed) settle(picker)
  })
}

/**
 * Moves the map so the rectangle frames these bounds, and narrows to them.
 *
 * The frame keeps its proportions, so what it frames holds the bounds and
 * meets them on one axis only. The move ends like any other, which is when the
 * form hears of the extent.
 */
export function frameOn(picker: Picker, bounds: BoundingBox): void {
  picker.narrowed = true
  picker.map.fitBounds(
    [
      [bounds.minLon, bounds.minLat],
      [bounds.maxLon, bounds.maxLat],
    ],
    { padding: paddingOf(FRAME, sizeOf(picker.map)) },
  )
}

/**
 * Tells the form what the rectangle frames, or the whole territory.
 *
 * A rectangle landing on no area tells nothing, which keeps the last extent:
 * the API refuses a rectangle without width or height.
 */
export function settle(picker: Picker): void {
  if (!picker.narrowed) {
    picker.framed(null)
    return
  }

  const { map } = picker
  const at = cornersOf(FRAME, sizeOf(map))
  const southWest = map.unproject([at.southWest.x, at.southWest.y])
  const northEast = map.unproject([at.northEast.x, at.northEast.y])
  const extent = extentBetween(
    { lon: southWest.lng, lat: southWest.lat },
    { lon: northEast.lng, lat: northEast.lat },
  )
  if (extent !== undefined) picker.framed(extent)
}

function sizeOf(map: MapLibreMap): Size {
  const { clientWidth: width, clientHeight: height } = map.getContainer()
  return { width, height }
}
