import type uPlot from 'uplot'

import { formatHour } from '../time.ts'
import { instantAt, type Cursor } from '../transport/reading.ts'
import type { Rung, Series } from './series.ts'

/** How wide a curve is drawn inside a bubble, and how tall. */
export const CURVE_WIDTH = 320
export const CURVE_HEIGHT = 140

/**
 * How much of the episode the curve shows, around the instant being read.
 *
 * Six hours, three on each side, which is what the mockup opened on. Wider, a
 * flood of a few hours flattens out; narrower, the shape of the rise is lost.
 */
const WINDOW = 6 * 60 * 60 * 1000

/** uPlot reads a time scale in seconds, where a cursor counts milliseconds. */
export const SECOND = 1000

/**
 * The hours the curve shows, centred on the instant being read.
 *
 * Centred always, and never held back at the edges of the period: the bar that
 * marks the instant is drawn at the middle of the plotting area and works
 * nothing out, so the day this window stops being symmetric the bar starts
 * naming an instant that is not the one being read. At an edge the curve simply
 * stops, and the empty half of the frame is the outside of the period.
 *
 * A fresh object each time, which uPlot needs: it takes the one it is handed
 * and writes in it.
 */
export function windowAround(at: Cursor): { min: number; max: number } {
  const middle = at / SECOND
  const half = WINDOW / 2 / SECOND

  return { min: middle - half, max: middle + half }
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

/** The hours of the time axis, in French time, as everything an agent reads. */
export function hourLabels(ticks: readonly number[]): string[] {
  return ticks.map((one) => formatHour(instantAt(one * SECOND)))
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
export const hours: uPlot.Axis.DynamicValues = (...given) => hourLabels(given[1])

export const figures: uPlot.Axis.DynamicValues = (...given) => figureLabels(given[1], given[4])
