/** A rectangle on the map, in pixels from its top-left corner. */
export type Rect = { left: number; top: number; right: number; bottom: number }

export type Padding = { top: number; right: number; bottom: number; left: number }

/**
 * The room kept between the map's edge and the outermost sources: a symbol is
 * drawn on its point, and the widest, a rain gauge's triangle on its ring,
 * reaches about twelve pixels from it.
 */
export const MARGIN = 24

/** How far from its point a symbol reaches, which must not slip under the legend. */
const REACH = 12

/** The zoom MapLibre goes no closer than, which is what one point alone is framed at. */
const MAX_ZOOM = 22

/** The width of the world at zoom 0, in MapLibre's pixels. */
const WORLD = 512

/**
 * The room to leave around the sources so that the map shows them all as close
 * as it can, and none of them under the legend.
 *
 * Three framings, each as close as its room allows: an even margin all round,
 * the sources kept below the legend, or kept beside it. The closest of those
 * that leave the legend's rectangle clear is the one: a legend reserved its
 * whole height down the side, where it covers only a corner, puts the replay
 * half a zoom further than it needs to be.
 */
export function clearOf(
  points: readonly [number, number][],
  size: { width: number; height: number },
  legend: Rect | undefined,
): Padding {
  const even = { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }
  if (legend === undefined || points.length === 0) return even

  const beside = { ...even, right: size.width - legend.left + MARGIN }
  const framings = [even, { ...even, top: legend.bottom + MARGIN }, beside]
  const clear = framings.filter(
    (padding) => !placed(points, size, padding).some((at) => under(at, legend)),
  )

  return clear.reduce(
    (best, one) => (scaleOf(points, size, one) > scaleOf(points, size, best) ? one : best),
    clear[0] ?? beside,
  )
}

/** Where each point lands, in pixels of the map, once framed with this room around them. */
export function placed(
  points: readonly [number, number][],
  size: { width: number; height: number },
  padding: Padding,
): [number, number][] {
  const projected = points.map(mercator)
  const { minX, minY, dx, dy } = extentOf(projected)
  const scale = scaleOf(points, size, padding)
  const roomX = size.width - padding.left - padding.right
  const roomY = size.height - padding.top - padding.bottom
  const offsetX = padding.left + (roomX - dx * scale) / 2
  const offsetY = padding.top + (roomY - dy * scale) / 2

  return projected.map(([x, y]) => [offsetX + (x - minX) * scale, offsetY + (y - minY) * scale])
}

/** Pixels per unit of the projected world, as `fitBounds` would choose them. */
function scaleOf(
  points: readonly [number, number][],
  size: { width: number; height: number },
  padding: Padding,
): number {
  const { dx, dy } = extentOf(points.map(mercator))
  const roomX = size.width - padding.left - padding.right
  const roomY = size.height - padding.top - padding.bottom
  if (roomX <= 0 || roomY <= 0) return 0
  return Math.min(roomX / dx, roomY / dy, WORLD * 2 ** MAX_ZOOM)
}

function extentOf(projected: readonly [number, number][]) {
  const xs = projected.map(([x]) => x)
  const ys = projected.map(([, y]) => y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { minX, minY, dx: Math.max(...xs) - minX, dy: Math.max(...ys) - minY }
}

/** Web Mercator, from 0 to 1 across the world and from its top down. */
function mercator([lon, lat]: [number, number]): [number, number] {
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return [(lon + 180) / 360, (1 - y / Math.PI) / 2]
}

function under([x, y]: [number, number], legend: Rect): boolean {
  return (
    x >= legend.left - REACH &&
    x <= legend.right + REACH &&
    y >= legend.top - REACH &&
    y <= legend.bottom + REACH
  )
}
