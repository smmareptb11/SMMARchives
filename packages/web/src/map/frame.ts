import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { Station } from '@smmarchives/shared/contracts/station.ts'

import type { ReplayContent } from '../tracks/lanes.ts'
import { drawnStation, framedIn, namedSourceOf, type DrawnSource, type Kind } from './sources.ts'
import type { Measured } from './windows.ts'

/** The gap between the map's edge and a window, all round. */
const MARGIN = 12

/**
 * The size of a window where it opens, in the map's top-left corner: a
 * detail's is fixed by its curve and a legend of thresholds on two lines, a
 * sheet's by its shortest text.
 */
const OPENED: Record<Opened, { width: number; height: number }> = {
  detail: { width: 560, height: 340 },
  sheet: { width: 380, height: 294 },
}

/** The least band left below a window for what the map goes to, and what is around it. */
const BELOW_LEAST = 80

/** What opens over the map with what it goes to: a station's detail, or a report's sheet. */
export type Opened = 'detail' | 'sheet'

/** Where the map goes to show an event: a spot it centres on, or an area it frames. */
export type Frame =
  | { kind: 'spot'; at: [number, number] }
  | { kind: 'area'; bounds: [[number, number], [number, number]] }

/** What a lane's name opens: a station, a structure or a rain gauge by its family and number, or a camera. */
export type Named = { source: Kind; id: number } | { camera: string }

/**
 * What the history or the lanes ask of the map: where to go, and the source
 * whose detail to open there — or none, for a report, which closes the detail
 * left open as a click on a report on the map does. A new object on every ask,
 * so asking again for the same card or the same lane goes there again.
 *
 * The source is the one the click named, resolved then and carried whole: the
 * map opens it on a new ask and on nothing else. Resolved again from the
 * replay, it would open again each time the replay changed — an event saved,
 * amended or removed reopening whatever station was asked last.
 */
export type Asked = { opens: Measured | undefined; frame: Frame | undefined }

/**
 * What a lane's name asks of the map: its source's detail or its camera's,
 * where it stands. Nothing for one the map has nowhere to draw, as a click on
 * the map could not reach it.
 */
export function laneAsked(content: ReplayContent, named: Named): Asked | undefined {
  if ('camera' in named) {
    const camera = content.webcams.find((one) => one.code === named.camera)
    if (camera === undefined) return undefined
    return {
      opens: { kind: 'camera', camera },
      frame: { kind: 'spot', at: [camera.position.lon, camera.position.lat] },
    }
  }
  const source = namedSourceOf(content, named)
  if (source === undefined) return undefined
  return { opens: { kind: 'source', source }, frame: { kind: 'spot', at: source.at } }
}

/** The station a crossing was read at, as the map draws it, if it draws it. */
export function crossingSource(
  stations: readonly Station[],
  id: number | undefined,
): DrawnSource | undefined {
  const station = stations.find((one) => one.id === id)
  return station === undefined ? undefined : drawnStation(station)
}

/**
 * Where an event is on the map: the place an agent gave it, or else the
 * station it was read at. Nothing for an event with neither, which the map has
 * nowhere to show.
 */
export function frameOf(event: ReplayEvent, stations: readonly Station[]): Frame | undefined {
  const { position } = event
  if (position?.type === 'Point') return { kind: 'spot', at: position.coordinates }
  if (position?.type === 'Polygon') return areaOf(position.coordinates[0] ?? [])

  const station = stations.find((one) => one.id === event.sourceId)
  if (station?.position == null) return undefined
  return { kind: 'spot', at: [station.position.lon, station.position.lat] }
}

/** The outer ring is the whole of the area: what it holds out cannot reach beyond it. */
function areaOf(ring: readonly [number, number][]): Frame | undefined {
  if (ring.length === 0) return undefined
  const lons = ring.map(([lon]) => lon)
  const lats = ring.map(([, lat]) => lat)
  return {
    kind: 'area',
    bounds: [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
  }
}

/**
 * The room left around what the map goes to: the legend's, as the replay
 * opens, and the window that opens with it in the map's top-left corner — a
 * station's detail, or a report's sheet. Otherwise what the map went to lands
 * under it.
 *
 * Beside the window while a quarter of the map's width stays between it and
 * the legend, else below it while a band of 80 px stays under it: a
 * band cut into the window would centre what the map goes to under it. On a
 * map with room for neither, only the legend's is left, as room the map does
 * not have makes MapLibre give up.
 */
export function roomFor(width: number, height: number, opened: Opened) {
  const room = framedIn(width, height)
  const window = OPENED[opened]

  const beside = MARGIN + window.width + MARGIN
  if (width - room.right - beside >= width / 4)
    return { ...room, left: Math.max(room.left, beside) }

  const below = MARGIN + window.height + MARGIN
  if (height - room.bottom - below >= BELOW_LEAST)
    return { ...room, top: Math.max(room.top, below) }

  return room
}

/**
 * How far from the map's centre a spot lands to stand in the middle of the room
 * left around it, as MapLibre's `offset` takes it.
 *
 * An offset rather than a `padding`: MapLibre keeps the padding a flight was
 * given as the map's own, and adds it to the room of every framing after it —
 * the overview, framed inside a window that is no longer there, would open
 * zoomed far out and off to one side.
 */
export function offsetFor(room: {
  top: number
  right: number
  bottom: number
  left: number
}): [number, number] {
  return [(room.left - room.right) / 2, (room.top - room.bottom) / 2]
}
