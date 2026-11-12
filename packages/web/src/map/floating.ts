/** How far a floating panel was moved from where it opens, in pixels. */
export type Offset = { x: number; y: number }

/** A panel where it opens, before any move, in the screen's pixels. */
export type Box = { left: number; top: number; width: number; height: number }

/**
 * The move asked for, held within the screen.
 *
 * A panel pushed off the screen would take its heading along, and with it the
 * only hold there is to bring it back. One taller or wider than the screen
 * keeps its top and its left in sight, where its heading and its way out are.
 */
export function offsetWithin(
  box: Box,
  wanted: Offset,
  screen: { width: number; height: number },
): Offset {
  return {
    x: within(wanted.x, -box.left, screen.width - box.left - box.width),
    y: within(wanted.y, -box.top, screen.height - box.top - box.height),
  }
}

export type Size = { width: number; height: number }

/** The least a window is made: its title bar, a value and a curve stay legible. */
export const LEAST: Size = { width: 320, height: 220 }

/**
 * The size asked for, held between the least a window is made and the screen's
 * right and bottom edges, from where the window stands: its corner, which is
 * what resizes it, stays where a pointer can take it again.
 */
export function sizeWithin(
  at: { left: number; top: number },
  wanted: Size,
  screen: Size,
  least: Size = LEAST,
): Size {
  return {
    width: within(wanted.width, least.width, Math.max(least.width, screen.width - at.left)),
    height: within(wanted.height, least.height, Math.max(least.height, screen.height - at.top)),
  }
}

function within(value: number, least: number, most: number): number {
  return Math.max(least, Math.min(value, most))
}
