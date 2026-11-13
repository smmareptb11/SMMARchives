import { useLayoutEffect, useRef, type RefObject } from 'react'
import uPlot from 'uplot'

import 'uplot/dist/uPlot.min.css'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { BRAND, MUTED } from '../palette.ts'
import { FRENCH_TIME } from '../time.ts'
import type { Cursor } from '../transport/reading.ts'
import {
  CURVE_HEIGHT,
  SECOND,
  boundsWith,
  figures,
  figuresWidth,
  followSize,
  hours,
  instantBar,
  placeInstant,
  plotted,
  windowOf,
  type Span,
} from './chart.ts'
import type { Rung, Series } from './series.ts'

/** How a rung is dashed, in CSS pixels, and how thick it is drawn. */
const DASH = [4, 3]
const RUNG = 1

/**
 * The curve of one station, around the instant being read.
 *
 * Drawn by uPlot outside React, in an element this component owns: a tick moves
 * the window of time and never rebuilds the drawing. Over a span the curve
 * slides under a bar that stays put; over the whole period the bar walks it.
 */
export function StationChart({
  series,
  ladder,
  at,
  span,
  period,
}: {
  series: Series
  ladder: readonly Rung[]
  at: Cursor
  span: Span
  period: TimeWindow
}) {
  const holder = useRef<HTMLDivElement>(null)
  const drawn = useRef<uPlot | undefined>(undefined)

  // Read by the hook that places the bar, on every draw uPlot makes.
  const reading = useRef<Cursor>(at)
  reading.current = at

  // Built on the window of the instant the series arrives on, so its first frame
  // is already right. The window is followed by the effect below; another
  // ladder is another chart, through this component's key.
  useLayoutEffect(() => {
    if (holder.current === null) return
    const chart = plot(holder.current, series, ladder, {
      window: windowOf(span, at, period),
      reading,
    })
    drawn.current = chart
    const unfollow = followSize(chart, holder.current, CURVE_HEIGHT)

    return () => {
      unfollow()
      chart.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- window followed below, `ladder` keyed above
  }, [series])

  // Before the frame is painted: set after it, the window would lag the reading
  // by one frame.
  useLayoutEffect(() => {
    drawn.current?.setScale('x', windowOf(span, at, period))
  }, [at, span, period])

  return <div className="plot" ref={holder} style={{ minHeight: CURVE_HEIGHT }} />
}

/** The window the chart opens on, and the instant its bar is placed at. */
type Frame = { window: { min: number; max: number }; reading: RefObject<Cursor> }

/** The curve, over the ladder its values are read against. */
function plot(
  holder: HTMLDivElement,
  series: Series,
  ladder: readonly Rung[],
  { window, reading }: Frame,
): uPlot {
  const bar = instantBar()

  const chart = new uPlot(
    {
      width: holder.clientWidth,
      height: CURVE_HEIGHT,
      legend: { show: false },
      // Nothing to hover: the reading gives the value beside the curve.
      cursor: { show: false },
      scales: {
        // The window belongs to the reading, so uPlot must not fit the data.
        x: { time: true, auto: false, ...window },
        y: { range: (_, low, high) => uPlot.rangeNum(...boundsWith(ladder, low, high), 0.1, true) },
      },
      // Or uPlot graduates the hours in the machine's own time zone.
      tzDate: (seconds) => uPlot.tzDate(new Date(seconds * SECOND), FRENCH_TIME),
      // Above, only what the topmost figure needs, where uPlot keeps half an axis
      // label; the sides are left to it, or the last hour is cut off.
      padding: [6, null, 0, null],
      series: [
        {},
        {
          stroke: BRAND,
          width: 2,
          // A line through one point draws nothing, and a station with a
          // degraded step can hold a single measure in a window.
          points: { show: (_, __, first, last) => last - first < 1 },
        },
      ],
      axes: [
        { stroke: MUTED, grid: { show: false }, space: 60, size: 28, values: hours },
        { stroke: MUTED, size: figuresWidth, values: figures },
      ],
      // After the grid and before the curve, which is the order uPlot draws in:
      // a threshold is what the curve is read against, never something over it.
      hooks: {
        drawAxes: [
          (self) => {
            rule(self, ladder)
          },
        ],
        draw: [
          (self) => {
            placeInstant(self, bar, reading.current)
          },
        ],
      },
    },
    plotted(series),
    holder,
  )
  chart.over.append(bar)

  return chart
}

/**
 * The rungs of the ladder, ruled across the whole frame rather than plotted: a
 * rung stopping where the measures stop would read as a second curve.
 * `boundsWith` is what tells the scale of values about them.
 */
function rule(chart: uPlot, ladder: readonly Rung[]): void {
  const { ctx } = chart
  const { left, width } = chart.bbox

  ctx.save()
  // In canvas pixels, which a dense screen counts twice per CSS pixel.
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
