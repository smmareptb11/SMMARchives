import { spanSaid, type Step } from '../rain.ts'
import { lastBefore, type Cursor } from '../transport/reading.ts'
import { SECOND } from './chart.ts'

/**
 * What a bar of the bubble is at the instant being read.
 *
 * Three states and not two: what the reading is standing on has to be told from
 * what it has already passed, or a reader looking for the figure beside the
 * chart cannot find which bar it came from.
 */
export type BarState = 'past' | 'read' | 'ahead'

/**
 * How faint a step the reading has not reached is drawn: on the chart, and on
 * the legend that says what such a bar is.
 */
export const AHEAD = 0.25

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

/**
 * How much room the heaviest bar of a window leaves under it, as the Acycliq
 * widget leaves it: a bar reaching the edge of the frame reads as one cut off.
 */
const HEADROOM = 1.1

/** What a window of the chart shows, in the seconds uPlot counts. */
export type Framed = {
  /** The rain summed measure by measure from the first inside the window; nothing outside it. */
  totals: (number | null)[]
  /** The top of the scale of bars, which every bar the window crosses counts towards. */
  rainTop: number
  /** The top of the scale of the running total. */
  totalTop: number
}

/**
 * The running total over a window, and the tops of both scales, as the Acycliq
 * widget works them out.
 *
 * From the first measure inside the window, and not from the start of the
 * period: what the curve says is how much fell over what the reader is looking
 * at, so a window of six hours starts from nothing. Every scale falls back on
 * one millimetre when the window holds no rain, so none collapses on zero.
 *
 * The bars are counted wherever they cross the window, and not only where they
 * end in it: a daily measure covers the whole of a window of six hours, and
 * left out of its scale it would fill the frame against a top of one.
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
 * How wide a bar is painted, in device pixels, from the span it covers.
 *
 * Its own span, one device pixel at the least: bars follow each other edge to
 * edge, and a floor wider than a five-minute step would have each cover the
 * next few — over bars painted faint, the overlaps add up into patches darker
 * than any bar. Only a measure with no span, a lone one, falls back on `least`,
 * or it would not be painted at all.
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
