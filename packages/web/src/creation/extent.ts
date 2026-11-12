import { SMMAR_TERRITORY } from '@smmarchives/shared'
import {
  intersectionOf,
  type BoundingBox,
  type Position,
} from '@smmarchives/shared/contracts/geometry.ts'

/** A pixel of the map, from its top-left corner. */
export type Point = { x: number; y: number }

export type Size = { width: number; height: number }

/**
 * Where the rectangle sits in the view, each side a fraction of it.
 *
 * Held on the screen, so that zooming or moving the map is how the extent is
 * set: it is whatever the rectangle frames.
 */
export type Frame = { left: number; top: number; right: number; bottom: number }

export const FRAME: Frame = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }

/** The pixels of a frame's corners: south-west is bottom-left, the y axis pointing down. */
export function cornersOf(frame: Frame, size: Size): { southWest: Point; northEast: Point } {
  return {
    southWest: { x: frame.left * size.width, y: frame.bottom * size.height },
    northEast: { x: frame.right * size.width, y: frame.top * size.height },
  }
}

/**
 * The pixels between each side of the view and the frame.
 *
 * What the map leaves around a rectangle it fits, so the rectangle lands in
 * the frame rather than across the whole view.
 */
export function paddingOf(
  frame: Frame,
  size: Size,
): { top: number; right: number; bottom: number; left: number } {
  return {
    top: frame.top * size.height,
    right: (1 - frame.right) * size.width,
    bottom: (1 - frame.bottom) * size.height,
    left: frame.left * size.width,
  }
}

/**
 * The pixels the map may show past its view, so the frame can land on its edge.
 *
 * The frame sits a margin inside each edge of the view. The map runs past the
 * view by that margin, so the frame can land on any ground the view opens on.
 */
export function reachOf(frame: Frame, size: Size): { southWest: Point; northEast: Point } {
  return {
    southWest: { x: -frame.left * size.width, y: (2 - frame.bottom) * size.height },
    northEast: { x: (2 - frame.right) * size.width, y: -frame.top * size.height },
  }
}

/** The side of the world in pixels at zoom 0, as MapLibre draws it. */
const TILE = 512

/**
 * Where a pixel of a view lands, the view being centred on `center` at `zoom`.
 *
 * Web Mercator, worked out rather than asked of the map: the map answers for
 * the view it stands on now, and the bounds it is held within are those of the
 * view it opened on, whatever it was moved to since.
 */
export function lonLatAt(
  center: [number, number],
  zoom: number,
  size: Size,
  pixel: Point,
): [number, number] {
  const world = TILE * 2 ** zoom
  const [lon, lat] = center
  const x = ((lon + 180) / 360) * world + pixel.x - size.width / 2
  const sine = Math.sin((lat * Math.PI) / 180)
  const y =
    (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * world + pixel.y - size.height / 2
  return [
    (x / world) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI,
  ]
}

/**
 * The extent between the two corners a frame lands on, cut to the territory.
 *
 * A frame reaching past the territory sends what it frames of it, which is
 * what the API accepts: nothing is ever replayed outside it.
 */
export function extentBetween(southWest: Position, northEast: Position): BoundingBox | undefined {
  const framed = {
    minLon: Math.min(southWest.lon, northEast.lon),
    minLat: Math.min(southWest.lat, northEast.lat),
    maxLon: Math.max(southWest.lon, northEast.lon),
    maxLat: Math.max(southWest.lat, northEast.lat),
  }
  return intersectionOf(framed, SMMAR_TERRITORY)
}
