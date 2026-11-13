import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import { Map as MapLibreMap, NavigationControl, type StyleSpecification } from 'maplibre-gl'
import type { RefObject } from 'react'

import {
  cornersOf,
  extentBetween,
  FRAME,
  lonLatAt,
  paddingOf,
  reachOf,
  type Size,
} from './extent.ts'

/**
 * The map and whether a rectangle narrows it. Not narrowed, it sends no extent:
 * a rectangle over the whole territory would drop the sources with no position.
 */
export type Picker = {
  map: MapLibreMap
  narrowed: boolean
  /** The union the rectangle was framed on, until the reader moves it off. */
  territory: string | undefined
  framed: Framed
  moving: (moving: boolean) => void
}

/** What the rectangle frames, and the union that names it if one does. */
export type Framing = { extent: BoundingBox | null; territory?: string }

export type Framed = (framing: Framing) => void

/** The whole fleet, on a map smaller than a replay's, hence a centre and zoom of its own. */
const OPENING = { center: [2.55, 43.0] as [number, number], zoom: 7.3 }

export function pickerOn(
  map: MapLibreMap,
  change: RefObject<Framed>,
  move: RefObject<(moving: boolean) => void>,
): Picker {
  return {
    map,
    narrowed: false,
    territory: undefined,
    framed: (framing) => change.current(framing),
    moving: (moving) => move.current(moving),
  }
}

/**
 * A map that stays north up, flat, and no wider than the territory: the extent is
 * read off two corners of the screen, and turned or tilted, the map would send a
 * box wider than the rectangle drawn over it.
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
  // Again whenever the map is resized: bounds held for the size it opened at
  // would leave the frame short of an edge, or let it past one.
  const holdWithin = () => {
    const size = sizeOf(map)
    const reach = reachOf(FRAME, size)
    map.setMaxBounds([
      lonLatAt(OPENING.center, OPENING.zoom, size, reach.southWest),
      lonLatAt(OPENING.center, OPENING.zoom, size, reach.northEast),
    ])
  }
  holdWithin()
  map.on('resize', holdWithin)
  map.touchZoomRotate.disableRotation()
  map.keyboard.disableRotation()
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
  return map
}

/**
 * Tells the form what the rectangle frames once the map comes to rest, and that
 * a narrowed map is moving: until then, the form holds the extent framed before.
 */
export function listen(picker: Picker): void {
  picker.map.on('movestart', (event) => {
    // Moved by the reader rather than framed on a union: the union no longer
    // names what the rectangle holds.
    if (event.originalEvent !== undefined) picker.territory = undefined
    if (picker.narrowed) picker.moving(true)
  })
  picker.map.on('moveend', () => {
    picker.moving(false)
    if (picker.narrowed) settle(picker)
  })
}

/**
 * Moves the map so the rectangle frames these bounds, and narrows to them. The
 * frame keeps its proportions, so it meets the bounds on one axis only; the form
 * hears of the extent when the move ends, as after any other.
 */
export function frameOn(picker: Picker, bounds: BoundingBox, territory: string): void {
  picker.narrowed = true
  picker.territory = territory
  picker.map.fitBounds(
    [
      [bounds.minLon, bounds.minLat],
      [bounds.maxLon, bounds.maxLat],
    ],
    { padding: paddingOf(FRAME, sizeOf(picker.map)) },
  )
}

/**
 * Tells the form what the rectangle frames, or the whole territory. A rectangle
 * landing on no area keeps the last extent: the API refuses one without width
 * or height.
 */
export function settle(picker: Picker): void {
  if (!picker.narrowed) {
    picker.framed({ extent: null })
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
  if (extent === undefined) return
  const { territory } = picker
  picker.framed(territory === undefined ? { extent } : { extent, territory })
}

function sizeOf(map: MapLibreMap): Size {
  const { clientWidth: width, clientHeight: height } = map.getContainer()
  return { width, height }
}
