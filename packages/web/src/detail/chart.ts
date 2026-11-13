import uPlot from 'uplot'

import type { Instant, TimeWindow } from '@smmarchives/shared/clock.ts'

import { formatDay, formatHour, hourOf } from '../time.ts'
import { instantAt, type Cursor } from '../transport/reading.ts'
import type { Pill } from './pills.ts'
import type { Rung, Series } from './series.ts'

/** How tall a curve is drawn inside a source's detail; its width is the panel's. */
export const CURVE_HEIGHT = 140

/**
 * Keeps a chart as wide as its holder and, once the holder grows into the room
 * left in a window the reader sized, as tall too, never under `least`. Returns
 * what stops following.
 */
export function followSize(chart: uPlot, holder: HTMLElement, least: number): () => void {
  const observer = new ResizeObserver(() => {
    // A holder that does not grow is as tall as the chart, which would follow itself.
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
 * What a station's curve opens on, three hours on each side: wider, a flood of a
 * few hours flattens out; narrower, the shape of the rise is lost.
 */
export const STATION_SPAN: Span = 6 * HOUR

/**
 * What a rain gauge's bars open on: the whole period, where a window of a few
 * hours would mostly miss a daily gauge's one measure.
 */
export const RAIN_SPAN: Span = 'all'

/**
 * The time a chart shows, in seconds: the period whole, or the span centred on
 * the instant even at the period's edges, where the curve simply stops. A fresh
 * object each time: uPlot writes in the one it is handed.
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
 * The bar of the instant, for the layer uPlot lays over the plotting area alone:
 * over the whole box, the value axis would shift it off its instant.
 */
export function instantBar(): HTMLDivElement {
  const bar = document.createElement('div')
  bar.className = 'instant'
  return bar
}

/**
 * Where the bar of the instant stands, in pixels of the plotting area, which uPlot
 * knows only once laid out: to call on its draw, after building and every resize.
 */
export function placeInstant(chart: uPlot, instant: HTMLElement, at: Cursor): void {
  instant.style.left = `${String(chart.valToPos(at / SECOND, 'x'))}px`
}

/** A series as uPlot takes it: the instants, then the values. */
export function plotted(series: Series): [number[], number[]] {
  return [series.points.map((one) => one.at / SECOND), series.points.map((one) => one.value)]
}

/**
 * What the scale of values has to cover: the window, and every rung with it,
 * which is ruled across the frame rather than plotted and would otherwise fall
 * off a curve running far under it. An empty window leaves the ladder to decide.
 */
export function boundsWith(ladder: readonly Rung[], low: number, high: number): [number, number] {
  const values = ladder.map((rung) => rung.value)

  return [Math.min(low, ...values), Math.max(high, ...values)]
}

/** A day, in the seconds uPlot steps its time axis by. */
const DAY = 24 * 60 * 60

/**
 * The time axis, in French time: the hours, and the day on a midnight so that
 * `00:00` says which day starts; the days alone once a tick stands for one.
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
 * The figures of the value axis, to the decimals their step needs rather than a
 * value's two: the scale refits the window, and a rise of a few centimetres
 * rounded to two decimals reads `0,99 / 0,99 / 1 / 1`.
 */
export function figureLabels(ticks: readonly number[], step: number): string[] {
  const figures = figuresOf(decimalsOf(step))

  return ticks.map((one) => figures.format(one))
}

/**
 * One formatter per count of decimals, kept: the axis is relabelled on every
 * frame, and building one costs more than the drawing it serves.
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
 * How many decimals a step needs for two ticks to read apart: its own, counted,
 * since uPlot also steps by 2,5, which its size alone would give none. Twenty is
 * the most `Intl` takes.
 */
function decimalsOf(step: number): number {
  if (!(step > 0)) return 0

  const [digits, exponent] = step.toExponential().split('e')
  const written = digits?.split('.')[1]?.length ?? 0

  return Math.min(20, Math.max(0, written - Number(exponent)))
}

/*
 * What the two axes write. Spread rather than named: uPlot passes five
 * arguments, one more than this repository allows a function.
 */
export const hours: uPlot.Axis.DynamicValues = (...given) => hourLabels(given[1], given[4])

export const figures: uPlot.Axis.DynamicValues = (...given) => figureLabels(given[1], given[4])

/** The narrowest the value axis is drawn. */
const NARROWEST = 44

/**
 * How wide the value axis has to be for its widest figure, and the room beside
 * it: in a fixed width, « 0,0700 » loses its « 0,0 » and reads 700.
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
 * The width of the value axis, measured on the figures uPlot is about to write.
 * Its typings call an axis's font a string; a built chart holds the font and its
 * size side by side.
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
