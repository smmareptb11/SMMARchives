import { spanSaid, type Step } from '../rain.ts'
import { lastBefore, type Cursor } from '../transport/reading.ts'
import { SECOND } from './chart.ts'

/**
 * What a bar of the bubble is at the instant being read: the one the reading
 * stands on is told from those passed, so the figure beside the chart can be
 * traced to its bar.
 */
export type BarState = 'past' | 'read' | 'ahead'

/**
 * How faint a step the reading has not reached is drawn: on the chart, and on
 * the legend that says what such a bar is.
 */
export const AHEAD = 0.25

export const NONE = -1

/**
 * Which bar the reading is standing on, as a rank, or `NONE` before the first.
 * Through `lastBefore`, as `rainAt` counts the header's total, so the figure and
 * the bar picked out are one measure even on the instant that falls on it.
 */
export function readAt(steps: readonly Step[], at: Cursor): number {
  const reached = lastBefore(steps, at)

  return reached === undefined ? NONE : steps.indexOf(reached)
}

/** The state of every bar at an instant, for the one pass that paints them. */
export function statesAt(steps: readonly Step[], at: Cursor): BarState[] {
  const read = readAt(steps, at)

  return steps.map((_, index) => (index === read ? 'read' : index < read ? 'past' : 'ahead'))
}

/**
 * How much room the heaviest bar of a window leaves under it, as the Acycliq
 * widget leaves it: a bar reaching the edge of the frame reads as one cut off.
 */
const HEADROOM = 1.1

/** What a window of the chart shows. */
export type Framed = {
  /** The rain summed measure by measure from the first inside the window; nothing outside it. */
  totals: (number | null)[]
  /** The top of the scale of bars, which every bar the window crosses counts towards. */
  rainTop: number
  /** The top of the scale of the running total. */
  totalTop: number
}

/**
 * The running total over a window, from its first measure, and the tops of both
 * scales, as the Acycliq widget works them out; one millimetre when the window
 * holds no rain. A bar counts towards its scale wherever it crosses the window:
 * a daily measure covers a whole window of six hours. The window is in the
 * seconds uPlot counts.
 */
export function framedIn(steps: readonly Step[], window: { min: number; max: number }): Framed {
  const totals: (number | null)[] = []
  let running = 0
  let heaviest = 0

  for (const step of steps) {
    const instant = step.at / SECOND
    if (instant >= window.min && step.from / SECOND <= window.max) {
      heaviest = Math.max(heaviest, step.millimetres)
    }
    if (instant < window.min || instant > window.max) {
      totals.push(null)
      continue
    }
    running += step.millimetres
    // To the hundredth, or a sum of tenths drifts to `0.30000000000000004`.
    totals.push(Math.round(running * 100) / 100)
  }

  return {
    totals,
    rainTop: heaviest > 0 ? heaviest * HEADROOM : 1,
    totalTop: running > 0 ? running : 1,
  }
}

/**
 * How wide a bar is painted, in device pixels: its own span, one pixel at the
 * least, since a wider floor would overlap faint bars into darker patches. Only
 * a lone measure, which has no span, falls back on `least`.
 */
export function barWidthOf(span: number, least: number): number {
  return span > 0 ? Math.max(span, 1) : least
}

/**
 * What the legend calls the bars: the widget's « Cumul pluvio / 1h », with the
 * gauge's own step, which a replay reads off the measures rather than asks for.
 */
export function barsLabel(stepMinutes: number | undefined): string {
  const over = spanSaid(stepMinutes)

  return over === undefined ? 'Cumul pluvio' : `Cumul pluvio / ${over}`
}
