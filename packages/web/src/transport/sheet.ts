/** How far a finger moves the transport before it is dragging rather than tapping. */
export const DRAG_START = 6

/**
 * Whether the lanes are open once the transport is let go: `travel` is how far
 * it was dragged, downwards positive, and `height` how far the lanes fold. A
 * short pull either way leaves them as they were.
 */
export function settled(open: boolean, travel: number, height: number): boolean {
  return open ? travel < height / 4 : travel < -height / 5
}

/**
 * How far below open the lanes stand under the finger, in pixels: from where
 * they were, moved by the drag, and never higher than open nor lower than folded.
 */
export function followed(open: boolean, travel: number, height: number): number {
  return Math.min(Math.max((open ? 0 : height) + travel, 0), height)
}

/**
 * The scroll that puts the reading in the middle of the lanes the screen shows,
 * which begin after the labels: centred on the screen, it would sit off-centre
 * in what can be read. The browser clamps a scroll past either end.
 */
export function centredScroll(
  fraction: number,
  labelWidth: number,
  trackWidth: number,
  viewWidth: number,
): number {
  return labelWidth + fraction * trackWidth - (labelWidth + viewWidth) / 2
}

/** The lanes as the screen shows them: how far they are scrolled, how far they can be, what is shown. */
export type LanesShown = {
  scroll: number
  maxScroll: number
  /** The labels' column, which the lanes pass under. */
  label: number
  /** The width of what the screen shows, labels included. */
  view: number
}

/** How far across the lanes shown the line goes before they turn a page, and where it lands. */
const AHEAD = 0.85
const BEHIND = 0.15

/** Whether a point of the lanes, in their own pixels, is among those shown. */
export function inView(x: number, lanes: LanesShown): boolean {
  return x >= lanes.scroll + lanes.label && x <= lanes.scroll + lanes.view
}

/**
 * The scroll that turns the lanes a page as the reading line, `line` pixels
 * along them, nears the edge of those shown: the line comes back near their
 * start, and what comes next is in sight. Nothing while the line is short of
 * the edge, nor once it is out of sight — the reader has scrolled elsewhere,
 * and is left there — nor at the end, where the lanes go no further.
 */
export function pageTurn(line: number, lanes: LanesShown): number | undefined {
  if (!inView(line, lanes)) return undefined
  const width = lanes.view - lanes.label
  if (line < lanes.scroll + lanes.label + AHEAD * width) return undefined
  const turned = Math.min(line - lanes.label - BEHIND * width, lanes.maxScroll)
  return turned > lanes.scroll + 1 ? turned : undefined
}

/** A page turn on its way: where to, and since when. */
export type Turning = { to: number; since: number }

/** How long a page turn is given to land before the lanes are read as left where they are. */
const TURNING = 800

/**
 * What the lanes do for the reading line, `line` pixels along them: come to it
 * in their middle when they open, or when what the reader asked for left it out
 * of sight; turn a page as it nears their edge, unless the reader is asking —
 * under a finger dragging the ruler, a page turned would move the instant it
 * points at; wait while a page turn is still on its way; stay otherwise.
 */
export function following(
  line: number,
  lanes: LanesShown,
  now: { opening: boolean; revealing: boolean; turning: Turning | undefined; at: number },
): { kind: 'centre' } | { kind: 'turn'; to: number } | { kind: 'wait' } | { kind: 'stay' } {
  if (now.opening || (now.revealing && !inView(line, lanes))) return { kind: 'centre' }
  if (now.revealing) return { kind: 'stay' }
  if (stillTurning(now.turning, lanes.scroll, now.at)) return { kind: 'wait' }
  const to = pageTurn(line, lanes)
  return to === undefined ? { kind: 'stay' } : { kind: 'turn', to }
}

/** Whether a page turn is still on its way, rather than landed or cut short by the reader. */
function stillTurning(turning: Turning | undefined, scroll: number, at: number): boolean {
  if (turning === undefined) return false
  return Math.abs(scroll - turning.to) > 2 && at - turning.since < TURNING
}
