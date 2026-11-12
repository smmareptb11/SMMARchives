import uPlot from 'uplot'

import type { Instant, TimeWindow } from '@smmarchives/shared/clock.ts'

import { formatDay, formatHour, hourOf } from '../time.ts'
import { instantAt, type Cursor } from '../transport/reading.ts'
import type { Pill } from './pills.ts'
import type { Rung, Series } from './series.ts'

/** How tall a curve is drawn inside a source's detail; its width is the panel's. */
export const CURVE_HEIGHT = 140

/**
 * Keeps a chart as wide as the element holding it, which the panel sizes: the
 * panel narrows with the window. As tall too, never under its own height, once
 * the reader has sized the window and the holder takes the room left in it.
 * Returns what stops following.
 *
 * The height only then: holding the chart, the element is otherwise as tall as
 * the chart is, and a chart made as tall as its holder would follow itself.
 */
export function followSize(chart: uPlot, holder: HTMLElement, least: number): () => void {
  const observer = new ResizeObserver(() => {
    const stretched = getComputedStyle(holder).flexGrow !== '0'
    const width = holder.clientWidth
    const height = stretched ? Math.max(least, holder.clientHeight) : least
    if (width === chart.width && height === chart.height) return
    chart.setSize({ width, height })
  })
  observer.observe(holder)

  return () => {
    observer.disconnect()
  }
}

/** uPlot reads a time scale in seconds, where a cursor counts milliseconds. */
export const SECOND = 1000

const HOUR = 60 * 60 * SECOND

/** How much of the period a chart shows: so many milliseconds around the instant, or all of it. */
export type Span = number | 'all'

/** The spans a reader picks from, which are the Acycliq widget's. */
export const SPANS: readonly Pill<Span>[] = [
  { label: '1h', value: HOUR },
  { label: '2h', value: 2 * HOUR },
  { label: '3h', value: 3 * HOUR },
  { label: '6h', value: 6 * HOUR },
  { label: '12h', value: 12 * HOUR },
  { label: '1j', value: 24 * HOUR },
  { label: 'Tout', value: 'all' },
]

/**
 * What a station's curve opens on: six hours, three on each side, which is
 * what the mockup opened on. Wider, a flood of a few hours flattens out;
 * narrower, the shape of the rise is lost.
 */
export const STATION_SPAN: Span = 6 * HOUR

/**
 * What a rain gauge's bars open on: the whole period, because a daily gauge
 * holds one measure, which a window of a few hours would show empty more often
 * than not.
 */
export const RAIN_SPAN: Span = 'all'

/**
 * The time a chart shows, in seconds: the span centred on the instant being
 * read, or the period whole.
 *
 * Centred always, and never held back at the edges of the period: the reader
 * finds the instant at the middle of the frame for the whole episode, and at an
 * edge the curve simply stops — the empty half of the frame is the outside of
 * the period.
 *
 * A fresh object each time, which uPlot needs: it takes the one it is handed
 * and writes in it.
 */
export function windowOf(span: Span, at: Cursor, period: TimeWindow): { min: number; max: number } {
  if (span === 'all') {
    return { min: Date.parse(period.from) / SECOND, max: Date.parse(period.to) / SECOND }
  }

  const middle = at / SECOND
  const half = span / 2 / SECOND

  return { min: middle - half, max: middle + half }
}

/**
 * The bar of the instant, for the layer uPlot lays over the plotting area
 * exactly rather than over the whole box: the axis of values insets that area,
 * and a bar placed over the whole box would sit beside the instant it marks.
 */
export function instantBar(): HTMLDivElement {
  const bar = document.createElement('div')
  bar.className = 'instant'
  return bar
}

/**
 * Where the bar of the instant stands, in pixels of the plotting area: uPlot knows them
 * once it has laid the chart out, which it does after it is built, and again on
 * every resize — the draw that follows both is where the bar is first set.
 */
export function placeInstant(chart: uPlot, instant: HTMLElement, at: Cursor): void {
  instant.style.left = `${String(chart.valToPos(at / SECOND, 'x'))}px`
}

/** A series as uPlot takes it: the instants, then the values. */
export function plotted(series: Series): [number[], number[]] {
  return [series.points.map((one) => one.at / SECOND), series.points.map((one) => one.value)]
}

/**
 * What the scale of values has to cover: the window, and every rung with it.
 *
 * The ladder is ruled across the frame rather than plotted, so nothing else
 * would tell the scale about it — and a curve running far under all of its
 * thresholds has to read as running far under them. A rung outside the scale
 * would not be there to say so.
 *
 * A window holding no measure hands no bounds of its own, and the ladder alone
 * then decides: which is the only reading left to give.
 */
export function boundsWith(ladder: readonly Rung[], low: number, high: number): [number, number] {
  const values = ladder.map((rung) => rung.value)

  return [Math.min(low, ...values), Math.max(high, ...values)]
}

/** A day, in the seconds uPlot steps its time axis by. */
const DAY = 24 * 60 * 60

/**
 * The time axis, in French time, as everything an agent reads: the hours, and
 * the day on a midnight — or the days alone once a tick stands for one. A
 * period of a few days graduated in hours would read `00:00` without saying
 * which day it starts.
 */
export function hourLabels(ticks: readonly number[], step: number): string[] {
  return ticks.map((one) => {
    const at = instantAt(one * SECOND)
    return step >= DAY || isMidnight(at) ? formatDay(at) : formatHour(at)
  })
}

/** Paris is offset from UTC by whole hours, so its full hours are UTC's. */
function isMidnight(at: Instant): boolean {
  return Date.parse(at) % HOUR === 0 && hourOf(at) === 0
}

/**
 * The figures of the value axis, carrying what the step between two of them
 * needs and nothing more.
 *
 * Not the two decimals a value is written with beside the curve. The scale
 * refits whatever the window holds, so a rise of a few centimetres fills the
 * frame — and rounded to the centilitre, its ladder reads
 * `0,99 / 0,99 / 1 / 1`, which looks like a broken axis where it is the
 * rounding that is.
 */
export function figureLabels(ticks: readonly number[], step: number): string[] {
  const figures = figuresOf(decimalsOf(step))

  return ticks.map((one) => figures.format(one))
}

/**
 * One formatter per count of decimals, built once and kept.
 *
 * The axis is relabelled on every frame the reading slides the window, and
 * building an `Intl.NumberFormat` costs more than the whole of the drawing it
 * serves. There are twenty-one of them at most, and a bubble asks for one.
 */
const FIGURES = new Map<number, Intl.NumberFormat>()

function figuresOf(decimals: number): Intl.NumberFormat {
  const held = FIGURES.get(decimals)
  if (held !== undefined) return held

  const made = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  FIGURES.set(decimals, made)

  return made
}

/**
 * How many decimals a step needs for two of its ticks to read apart.
 *
 * The step's own decimals, counted rather than deduced from its size: uPlot
 * steps by one, two, two and a half, or five times a power of ten, and a step
 * of 2,5 needs one decimal where its size alone would say none. Twenty is the
 * most `Intl` takes, and a step of zero is not a step.
 */
function decimalsOf(step: number): number {
  if (!(step > 0)) return 0

  const [digits, exponent] = step.toExponential().split('e')
  const written = digits?.split('.')[1]?.length ?? 0

  return Math.min(20, Math.max(0, written - Number(exponent)))
}

/*
 * What the two axes write, out of what uPlot hands them.
 *
 * Taken whole and unpacked rather than named in the signature: uPlot passes five
 * arguments, of which two are wanted, and five parameters is one more than this
 * repository allows a function. Here rather than in either chart, because both
 * bubbles graduate their hours and their figures the same way and are read one
 * after the other in the same popup.
 */
export const hours: uPlot.Axis.DynamicValues = (...given) => hourLabels(given[1], given[4])

export const figures: uPlot.Axis.DynamicValues = (...given) => figureLabels(given[1], given[4])

/** The narrowest the value axis is drawn: what it was held to before it followed its figures. */
const NARROWEST = 44

/**
 * How wide the value axis has to be for its widest figure, and the room beside it.
 *
 * A curve that barely moves is graduated in thousandths, and « 0,0700 » in a
 * fixed width lost its « 0,0 » to the edge — read as 700. The plotting area
 * gives up the width instead, and the bar of the instant, laid over that area,
 * goes with it.
 */
export function axisWidth(
  labels: readonly string[] | null,
  measure: (text: string) => number,
  room: number,
): number {
  const widest = Math.max(0, ...(labels ?? []).map(measure))
  return Math.max(NARROWEST, Math.ceil(widest + room))
}

/** What uPlot draws an axis with when it is told nothing: ten-pixel ticks, five pixels apart from the figures. */
const TICKS = 10
const GAP = 5

/**
 * The width of the value axis, measured on what uPlot is about to write there.
 *
 * uPlot asks again until the answer holds still, so the figures it writes are
 * the ones measured. Its typings call an axis's font a string; once the chart
 * is built it holds the font and its size side by side, and the font is what
 * the canvas measures with.
 */
export const figuresWidth: uPlot.Axis.Size = (self, values, axisIndex) => {
  const axis = self.axes[axisIndex]
  const font: unknown = axis?.font
  self.ctx.font = String(Array.isArray(font) ? font[0] : font)

  return axisWidth(
    values,
    (text) => self.ctx.measureText(text).width / uPlot.pxRatio,
    (axis?.ticks?.size ?? TICKS) + (axis?.gap ?? GAP),
  )
}
