import { useLayoutEffect, useRef } from 'react'
import uPlot from 'uplot'

import 'uplot/dist/uPlot.min.css'

import { BRAND, MUTED } from '../palette.ts'
import { FRENCH_TIME } from '../time.ts'
import type { Cursor } from '../transport/reading.ts'
import {
  CURVE_HEIGHT,
  CURVE_WIDTH,
  SECOND,
  boundsWith,
  figures,
  hours,
  plotted,
  windowAround,
} from './chart.ts'
import type { Rung, Series } from './series.ts'

/** How a rung is dashed, in CSS pixels, and how thick it is drawn. */
const DASH = [4, 3]
const RUNG = 1

/**
 * The curve of one station, around the instant being read.
 *
 * Drawn by uPlot in an element this component owns, outside React: a canvas
 * thrown away and rebuilt on every tick of the reading would draw nothing but
 * itself.
 *
 * The instant does not move. The window is centred on the cursor, so the curve
 * slides under a bar that stays where it is, and the eye reads the same place
 * for the whole episode. What a tick changes is therefore the window of time,
 * never the drawing.
 */
export function StationChart({
  series,
  ladder,
  at,
}: {
  series: Series
  ladder: readonly Rung[]
  at: Cursor
}) {
  const holder = useRef<HTMLDivElement>(null)
  const drawn = useRef<uPlot | undefined>(undefined)

  // Built on the window of the instant the series arrives on, so that the first
  // frame it is painted on is already the right one. `at` and `ladder` are read
  // here and never watched: the effect below is what follows the reading, and
  // another station is another chart, which the key on this component makes so.
  useLayoutEffect(() => {
    if (holder.current === null) return
    const chart = plot(holder.current, series, ladder, windowAround(at))
    drawn.current = chart

    return () => chart.destroy()
    // Two omissions, two reasons. `at` is followed by the effect below, which is what the comment
    // above says. `ladder` is a fresh array on every render, and another ladder is another chart:
    // the key on `StationMeasures` sees to that.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `at` followed below, `ladder` keyed above
  }, [series])

  // Before the frame is painted: set after it, the window would lag the reading
  // by one frame.
  useLayoutEffect(() => {
    drawn.current?.setScale('x', windowAround(at))
  }, [at])

  return <div className="plot" ref={holder} />
}

/** The curve, over the ladder its values are read against. */
function plot(
  holder: HTMLDivElement,
  series: Series,
  ladder: readonly Rung[],
  window: { min: number; max: number },
): uPlot {
  const chart = new uPlot(
    {
      width: CURVE_WIDTH,
      height: CURVE_HEIGHT,
      legend: { show: false },
      // Nothing to hover in a bubble: the value beside the curve is the one
      // being read, and the reading gives it without a pointer.
      cursor: { show: false },
      scales: {
        // The window belongs to the reading, so uPlot must not fit the data.
        x: { time: true, auto: false, ...window },
        y: { range: (_, low, high) => uPlot.rangeNum(...boundsWith(ladder, low, high), 0.1, true) },
      },
      // Or uPlot rules the hours on the machine's own midnights, and a replay
      // of the Aude read from Tehran would be graduated on its half-hours.
      tzDate: (seconds) => uPlot.tzDate(new Date(seconds * SECOND), FRENCH_TIME),
      // Only what the topmost figure of the value axis needs; uPlot otherwise
      // keeps half the height of an axis label free above the curve, which a
      // bubble cannot spare. The sides are left to it, where the last hour of
      // the axis would be cut off.
      padding: [6, null, 0, null],
      series: [
        {},
        {
          stroke: BRAND,
          width: 2,
          // A line through one point draws nothing at all, and a window holding
          // a single measure is what a station with a degraded step gives: the
          // mark is then the only thing that says the curve is there.
          points: { show: (_, __, first, last) => last - first < 1 },
        },
      ],
      axes: [
        { stroke: MUTED, grid: { show: false }, space: 60, size: 28, values: hours },
        { stroke: MUTED, size: 44, values: figures },
      ],
      // After the grid and before the curve, which is the order uPlot draws in:
      // a threshold is what the curve is read against, never something over it.
      hooks: {
        drawAxes: [
          (self) => {
            rule(self, ladder)
          },
        ],
      },
    },
    plotted(series),
    holder,
  )

  // In the layer uPlot lays over the plotting area exactly, rather than over
  // the whole box: the y axis insets that area, and a bar at the middle of the
  // box would sit beside the instant it claims to mark.
  const bar = document.createElement('div')
  bar.className = 'instant'
  chart.over.append(bar)

  return chart
}

/**
 * The rungs of the ladder, ruled across the whole frame.
 *
 * Across the whole of it, and not only where the station measured: a rung is
 * the mark the curve is read against, and one stopping where the measures stop
 * would be a second curve. That is what a flat series would have been — which
 * is why the ladder is drawn here instead, and why `boundsWith` is what tells
 * the scale of values about it.
 */
function rule(chart: uPlot, ladder: readonly Rung[]): void {
  const { ctx } = chart
  const { left, width } = chart.bbox

  ctx.save()
  // In canvas pixels, which a dense screen counts twice: the dash and the
  // thickness are written in the CSS pixels the rest of the interface is.
  ctx.lineWidth = RUNG * uPlot.pxRatio
  ctx.setLineDash(DASH.map((one) => one * uPlot.pxRatio))

  for (const rung of ladder) {
    const y = chart.valToPos(rung.value, 'y', true)
    ctx.strokeStyle = rung.colour
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(left + width, y)
    ctx.stroke()
  }

  ctx.restore()
}
