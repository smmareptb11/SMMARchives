import { useLayoutEffect, useRef, type RefObject } from 'react'
import uPlot from 'uplot'

import 'uplot/dist/uPlot.min.css'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { BRAND, MUTED, RAIN } from '../palette.ts'
import { scaleOf, type Step } from '../rain.ts'
import { FRENCH_TIME } from '../time.ts'
import type { Cursor } from '../transport/reading.ts'
import { CURVE_HEIGHT, CURVE_WIDTH, SECOND, figures, hours } from './chart.ts'
import { NONE, readAt, statesAt, type BarState } from './rain-chart.ts'

/** How faint a step the reading has not reached is drawn. */
const AHEAD = 0.25

/**
 * The pixels a bar keeps whatever it measures, so no measure goes undrawn.
 *
 * The width is what a measure carrying no step falls back on, which is most of
 * a whole-parc replay's gauges — see `scaleOf`. A bar one pixel wide reads
 * as a rule and not as a quantity; wide enough to be a bar, narrow enough that
 * nobody reads it as a span the gauge never gave.
 */
const LEAST_WIDTH = 8
const LEAST_HEIGHT = 2

/**
 * What a rain gauge measured, measure by measure, over the whole period.
 *
 * Bars and not a curve, and the whole period and not a window around the
 * cursor: a gauge gives what fell during a step, where a station gives a level
 * at an instant — and a daily gauge holds one measure, which a six-hour window
 * would show empty more often than not.
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
}: {
  steps: readonly Step[]
  period: TimeWindow
  at: Cursor
}) {
  const holder = useRef<HTMLDivElement>(null)
  const drawn = useRef<Drawn | undefined>(undefined)

  // The instant is read by the hook when it paints, never watched by the effect
  // that builds the chart: a chart thrown away and rebuilt sixty times a second
  // would draw nothing but itself.
  const reading = useRef<Cursor>(at)
  reading.current = at

  useLayoutEffect(() => {
    if (holder.current === null) return
    const chart = plot(holder.current, steps, period, reading)

    // In the layer uPlot lays over the plotting area exactly, as the station's
    // curve does: the axis of values insets that area, and a bar placed over the
    // whole box would name an instant beside the one being read.
    const instant = document.createElement('div')
    instant.className = 'instant'
    chart.over.append(instant)
    drawn.current = { chart, instant, read: NONE }

    return () => {
      chart.destroy()
    }
  }, [steps, period])

  // Two things follow the reading, and only one of them is a drawing. The rule
  // slides on every tick and is a node the browser moves; the bars change at
  // most once per measure — repainting them sixty times a second would redraw
  // two hundred and eighty-nine rectangles and relabel both axes to move a line.
  useLayoutEffect(() => {
    const held = drawn.current
    if (held === undefined) return

    held.instant.style.left = `${String(held.chart.valToPos(at / SECOND, 'x'))}px`

    const read = readAt(steps, at)
    if (read === held.read) return

    held.read = read
    held.chart.redraw(false, false)
  }, [at, steps])

  return <div className="plot" ref={holder} />
}

/** The chart, its rule, and the bar the rule was last drawn standing on. */
type Drawn = { chart: uPlot; instant: HTMLDivElement; read: number }

function plot(
  holder: HTMLDivElement,
  steps: readonly Step[],
  period: TimeWindow,
  reading: RefObject<Cursor>,
): uPlot {
  return new uPlot(
    {
      width: CURVE_WIDTH,
      height: CURVE_HEIGHT,
      legend: { show: false },
      cursor: { show: false },
      scales: {
        // The period, fixed: what a gauge measured over the replay is the whole
        // of what there is to show, and it does not slide with the reading.
        x: {
          time: true,
          auto: false,
          min: Date.parse(period.from) / SECOND,
          max: Date.parse(period.to) / SECOND,
        },
        // From zero, always: a bar is read against the floor it stands on, and
        // a scale starting elsewhere would make a small step look like a large
        // one. The top is the gauge's own, which `scaleOf` floors.
        y: { auto: false, min: 0, max: scaleOf(steps) },
      },
      tzDate: (seconds) => uPlot.tzDate(new Date(seconds * SECOND), FRENCH_TIME),
      padding: [6, null, 0, null],
      // uPlot is asked for the frame and never for the marks: the bars are
      // painted below, over the span each measure was gathered on.
      series: [{}, { paths: () => null, points: { show: false } }],
      axes: [
        { stroke: MUTED, grid: { show: false }, space: 60, size: 28, values: hours },
        { stroke: MUTED, size: 44, values: figures },
      ],
      hooks: {
        draw: [
          (self) => {
            paint(self, steps, reading.current)
          },
        ],
      },
    },
    // What tells uPlot there is data at all; the bars are painted below.
    [steps.map((one) => one.at / SECOND), steps.map((one) => one.millimetres)],
    holder,
  )
}

/**
 * One bar per measure, over the span it was gathered on.
 *
 * A floor of a few pixels on both sides: a measure of zero draws a bar, and so
 * does a lone measure, which carries no step and is therefore an instant wide.
 * Neither is an absence, and a bar nobody can see is what an absence looks like.
 */
function paint(chart: uPlot, steps: readonly Step[], at: Cursor): void {
  const { ctx } = chart
  const { left, top, width, height } = chart.bbox
  const states = statesAt(steps, at)

  ctx.save()
  // A step gathered before the replay began runs off the left of the frame, and
  // would otherwise be painted over the axis of values.
  ctx.beginPath()
  ctx.rect(left, top, width, height)
  ctx.clip()

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

  const wide = Math.max(ends - begins, LEAST_WIDTH * uPlot.pxRatio)
  const tall = Math.max(floor - reached, LEAST_HEIGHT * uPlot.pxRatio)

  ctx.globalAlpha = state === 'ahead' ? AHEAD : 1
  // The measure the header's total stops at, darker than the ones behind it.
  // Not the red of the reading: that one rules the instant, and a bar wearing
  // it would claim to be where the reading is rather than what it last passed.
  ctx.fillStyle = state === 'read' ? BRAND : RAIN
  ctx.fillRect(ends - wide, floor - tall, wide, tall)
}
