import { useLayoutEffect, useRef, type RefObject } from 'react'
import uPlot from 'uplot'

import 'uplot/dist/uPlot.min.css'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { BRAND, CUMUL, MUTED, RAIN } from '../palette.ts'
import type { Step } from '../rain.ts'
import { FRENCH_TIME } from '../time.ts'
import type { Cursor } from '../transport/reading.ts'
import {
  SECOND,
  figures,
  figuresWidth,
  followSize,
  hours,
  instantBar,
  placeInstant,
  windowOf,
  type Span,
} from './chart.ts'
import {
  AHEAD,
  NONE,
  barWidthOf,
  framedIn,
  readAt,
  statesAt,
  type BarState,
  type Framed,
} from './rain-chart.ts'

/** Taller than a station's curve: two axes carry their titles beside a frame of bars and a curve. */
const HEIGHT = 200

/** How thick the running total is drawn, in CSS pixels: the widget's own. */
const TOTAL = 2

/**
 * The pixels a bar keeps whatever it measures, so no measure goes undrawn.
 *
 * The width is what a measure carrying no step falls back on, which is most of
 * a whole-parc replay's gauges, and only it: a bar with a step is as wide as
 * that step, see `barWidthOf`. A bar one pixel wide reads
 * as a rule and not as a quantity; wide enough to be a bar, narrow enough that
 * nobody reads it as a span the gauge never gave.
 */
const LEAST_WIDTH = 8
const LEAST_HEIGHT = 2

/**
 * What a rain gauge measured, measure by measure, and how much that adds up to
 * over the window, as the Acycliq widget draws it.
 *
 * Bars and not a curve: a gauge gives what fell during a step, where a station
 * gives a level at an instant. The running total rises over them, on an axis
 * of its own.
 *
 * Drawn by hand in a hook rather than by uPlot's own bars, because a bar here
 * covers the step it was gathered over: uPlot centres a bar on its instant and
 * takes its width from the gap to the next one, which says nothing when a gauge
 * has a single measure.
 */
export function RainChart({
  steps,
  period,
  at,
  span,
}: {
  steps: readonly Step[]
  period: TimeWindow
  at: Cursor
  span: Span
}) {
  const holder = useRef<HTMLDivElement>(null)
  const drawn = useRef<Drawn | undefined>(undefined)

  // The instant is read by the hook when it paints, never watched by the effect
  // that builds the chart: a chart thrown away and rebuilt sixty times a second
  // would draw nothing but itself.
  const reading = useRef<Cursor>(at)
  reading.current = at
  // Read once by the build, which must not watch it: the effect below follows it.
  const spanned = useRef<Span>(span)
  spanned.current = span

  useLayoutEffect(() => {
    if (holder.current === null) return
    const held = plot(holder.current, steps, period, { reading, span: spanned.current })
    drawn.current = held
    const { chart } = held
    const unfollow = followSize(chart, holder.current, HEIGHT)

    return () => {
      unfollow()
      chart.destroy()
    }
  }, [steps, period])

  // Over the whole period, two things follow the reading, and only one of them
  // is a drawing. The rule slides on every tick and is a node the browser moves;
  // the bars change at most once per measure — repainting them sixty times a
  // second would redraw two hundred and eighty-nine rectangles and relabel both
  // axes to move a line. Over a span the bars slide under the rule, and moving
  // them is a drawing on every tick, as a station's curve is.
  useLayoutEffect(() => {
    const held = drawn.current
    if (held === undefined) return

    const read = readAt(steps, at)

    if (span !== 'all' || span !== held.span) {
      held.span = span
      held.read = read
      frame(held, steps, windowOf(span, at, period))
      return
    }

    placeInstant(held.chart, held.instant, at)
    if (read === held.read) return

    held.read = read
    held.chart.redraw(false, false)
  }, [at, steps, span, period])

  return <div className="plot" ref={holder} style={{ minHeight: HEIGHT }} />
}

/**
 * The chart, its rule, the bar the rule was last drawn standing on, the span it
 * shows, and what the window it shows holds.
 */
type Drawn = {
  chart: uPlot
  instant: HTMLDivElement
  read: number
  span: Span
  /** In a box of its own, which the draw hook holds from before the chart is built. */
  framed: { current: Framed }
}

/**
 * Moves the chart onto a window, and both scales of values with it, in one
 * draw: the tops are the window's own, and set after the window they would
 * paint one frame against the last one's.
 */
function frame(held: Drawn, steps: readonly Step[], window: { min: number; max: number }): void {
  const framed = framedIn(steps, window)
  held.framed.current = framed
  held.chart.batch(() => {
    held.chart.setScale('x', window)
    held.chart.setScale('y', { min: 0, max: framed.rainTop })
    held.chart.setScale('total', { min: 0, max: framed.totalTop })
  })
}

/**
 * uPlot is asked for the frame and never for the marks: the bars and the total
 * are painted by hand, the bars over the span each measure was gathered on.
 *
 * Fresh for every chart, as the axes are: uPlot writes its own state into the
 * arrays it is handed, and two gauges open side by side would share it.
 */
const series = (): uPlot.Series[] => [
  {},
  { paths: () => null, points: { show: false } },
  { scale: 'total', paths: () => null, points: { show: false } },
]

/** The hours, the bars' figures on the left and the total's on the right, as the widget's. */
const axes = (): uPlot.Axis[] => [
  { stroke: MUTED, grid: { show: false }, space: 60, size: 28, values: hours },
  { stroke: MUTED, size: figuresWidth, values: figures, label: 'pluviométrie (mm)' },
  {
    side: 1,
    scale: 'total',
    stroke: MUTED,
    grid: { show: false },
    size: figuresWidth,
    values: figures,
    label: 'pluviométrie cumulée (mm)',
  },
]

function plot(
  holder: HTMLDivElement,
  steps: readonly Step[],
  period: TimeWindow,
  { reading, span }: { reading: RefObject<Cursor>; span: Span },
): Drawn {
  const instant = instantBar()
  const window = windowOf(span, reading.current, period)
  // Built before the chart is, which the draw hook reads from its very first frame.
  const framed = { current: framedIn(steps, window) }

  const chart = new uPlot(
    {
      width: holder.clientWidth,
      height: HEIGHT,
      legend: { show: false },
      cursor: { show: false },
      scales: {
        // The window belongs to the reading, so uPlot must not fit the data.
        x: { time: true, auto: false, ...window },
        // From zero, always, and both of them: a bar and a total are read
        // against the floor they stand on, and a scale starting elsewhere would
        // make a small step look like a large one.
        y: { auto: false, min: 0, max: framed.current.rainTop },
        total: { auto: false, min: 0, max: framed.current.totalTop },
      },
      tzDate: (seconds) => uPlot.tzDate(new Date(seconds * SECOND), FRENCH_TIME),
      padding: [6, null, 0, null],
      series: series(),
      axes: axes(),
      hooks: {
        draw: [
          (self) => {
            const states = statesAt(steps, reading.current)
            paint(self, steps, states)
            trace(self, steps, framed.current.totals, states)
            placeInstant(self, instant, reading.current)
          },
        ],
      },
    },
    // What tells uPlot there is data at all; the bars and the total are painted below.
    [
      steps.map((one) => one.at / SECOND),
      steps.map((one) => one.millimetres),
      steps.map(() => null),
    ],
    holder,
  )
  chart.over.append(instant)

  return { chart, instant, read: NONE, span, framed }
}

/** Keeps what the hook paints inside the plotting area, the axes on both sides left alone. */
function clip(chart: uPlot): void {
  const { left, top, width, height } = chart.bbox
  chart.ctx.beginPath()
  chart.ctx.rect(left, top, width, height)
  chart.ctx.clip()
}

/**
 * One bar per measure, over the span it was gathered on.
 *
 * A floor of a few pixels: a measure of zero draws a bar, and so does a lone
 * measure, which carries no step and is therefore an instant wide.
 * Neither is an absence, and a bar nobody can see is what an absence looks like.
 */
function paint(chart: uPlot, steps: readonly Step[], states: readonly BarState[]): void {
  const { ctx } = chart

  ctx.save()
  // A step gathered before the replay began runs off the left of the frame, and
  // would otherwise be painted over the axis of values.
  clip(chart)

  for (const [index, step] of steps.entries()) {
    bar(ctx, chart, step, states[index])
  }
  ctx.restore()
}

function bar(
  ctx: CanvasRenderingContext2D,
  chart: uPlot,
  step: Step,
  state: BarState | undefined,
): void {
  const ends = chart.valToPos(step.at / SECOND, 'x', true)
  const begins = chart.valToPos(step.from / SECOND, 'x', true)
  const floor = chart.valToPos(0, 'y', true)
  const reached = chart.valToPos(step.millimetres, 'y', true)

  const wide = barWidthOf(ends - begins, LEAST_WIDTH * uPlot.pxRatio)
  const tall = Math.max(floor - reached, LEAST_HEIGHT * uPlot.pxRatio)

  ctx.globalAlpha = state === 'ahead' ? AHEAD : 1
  // The measure the header's total stops at, darker than the ones behind it.
  // Not the red of the reading: that one rules the instant, and a bar wearing
  // it would claim to be where the reading is rather than what it last passed.
  ctx.fillStyle = state === 'read' ? BRAND : RAIN
  ctx.fillRect(ends - wide, floor - tall, wide, tall)
}

/**
 * The running total, measure to measure, as faint as the bars past the one the
 * reading stands on: what is ahead of the reading is what the replay holds, not
 * what the reader has been shown fall.
 */
function trace(
  chart: uPlot,
  steps: readonly Step[],
  totals: readonly (number | null)[],
  states: readonly BarState[],
): void {
  const { ctx } = chart
  const points = steps.flatMap((step, index) => {
    const total = totals[index]
    if (total === null || total === undefined) return []
    return [
      {
        x: chart.valToPos(step.at / SECOND, 'x', true),
        y: chart.valToPos(total, 'total', true),
        ahead: states[index] === 'ahead',
      },
    ]
  })

  ctx.save()
  clip(chart)
  ctx.strokeStyle = CUMUL
  ctx.lineWidth = TOTAL * uPlot.pxRatio
  ctx.lineJoin = 'round'

  // Two strokes, so the faint one starts on the last point the reading passed.
  const reached = points.findLastIndex((one) => !one.ahead)
  line(ctx, points.slice(0, reached + 1), 1)
  line(ctx, points.slice(Math.max(reached, 0)), AHEAD)
  ctx.restore()
}

function line(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  alpha: number,
): void {
  if (points.length < 2) return

  ctx.globalAlpha = alpha
  ctx.beginPath()
  for (const [index, { x, y }] of points.entries()) {
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}
