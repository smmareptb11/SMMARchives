import type { Step } from '../rain.ts'
import { lastBefore, type Cursor } from '../transport/reading.ts'

/**
 * What a bar of the bubble is at the instant being read.
 *
 * Three states and not two: what the reading is standing on has to be told from
 * what it has already passed, or a reader looking for the figure beside the
 * chart cannot find which bar it came from.
 */
export type BarState = 'past' | 'read' | 'ahead'

/**
 * Which bar the reading is standing on, as a rank, or `NONE` before the first.
 *
 * Through `lastBefore`, which is where « the last thing known before an instant »
 * is written — the same answer `rainAt` counts the running total up to, so the
 * figure in the header and the bar picked out below it can never be two
 * different measures, on the instant that falls exactly on one.
 */
export const NONE = -1

export function readAt(steps: readonly Step[], at: Cursor): number {
  const reached = lastBefore(steps, at)

  return reached === undefined ? NONE : steps.indexOf(reached)
}

/** The state of every bar at an instant, for the one pass that paints them. */
export function statesAt(steps: readonly Step[], at: Cursor): BarState[] {
  const read = readAt(steps, at)

  return steps.map((_, index) => (index === read ? 'read' : index < read ? 'past' : 'ahead'))
}
