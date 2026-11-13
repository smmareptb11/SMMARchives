import { UNITS } from '@smmarchives/shared'
import { medianStepOf } from '@smmarchives/shared/clock.ts'
import type { Measure } from '@smmarchives/shared/contracts/measure.ts'

import { formatValue } from './detail/series.ts'
import { lastBefore, type Cursor } from './transport/reading.ts'

const HOUR = 60

/** How much had fallen by one of a gauge's instants, counting from the start. */
type Fallen = { at: Cursor; millimetres: number }

/** What one rain gauge holds over the period, which no cursor changes. */
export type Gauge = {
  /** Its running totals, oldest first. */
  fallen: Fallen[]
  /**
   * The median gap between two of its measures, in minutes: nothing for a single
   * measure, zero for measures too close to tell apart. Read it through
   * `readable`, never as a span as it stands.
   */
  stepMinutes: number | undefined
}

/** The parc's rain, gauge by gauge. A gauge that measured nothing has no entry. */
export type Gauges = Map<number, Gauge>

/** What a gauge had measured at the instant being read. */
export type Rain = {
  millimetres: number
  /** When the last measure counted was taken; nothing before the first. */
  last: Cursor | undefined
}

/**
 * The parc's rain, gauge by gauge, as running totals: a gauge gives what fell
 * during a step, so two measures of five millimetres are ten, never a rise to
 * five. Worked out once, then read at each instant.
 *
 * The quantity is what keeps this on rain gauges: an identifier names one source
 * of each family.
 */
export function gaugesOf(measures: readonly Measure[]): Gauges {
  const held = new Map<number, Measure[]>()

  for (const one of measures) {
    if (one.quantity !== 'rainfall') continue

    const mine = held.get(one.sourceId)
    if (mine === undefined) held.set(one.sourceId, [one])
    else mine.push(one)
  }

  return new Map([...held].map(([sourceId, mine]) => [sourceId, gaugeOf(mine)]))
}

/** What a gauge had measured by an instant, without walking its measures again. */
export function rainAt(gauge: Gauge, at: Cursor): Rain {
  const reached = lastBefore(gauge.fallen, at)

  return {
    millimetres: reached?.millimetres ?? 0,
    last: reached?.at,
  }
}

/**
 * One gauge's running totals, one entry per instant: two measures at one
 * instant, which Aquasys can send, are added as the total would add them.
 */
function gaugeOf(measures: readonly Measure[]): Gauge {
  const perInstant = new Map<Cursor, number>()
  for (const one of measures) {
    const at = Date.parse(one.at)
    perInstant.set(at, (perInstant.get(at) ?? 0) + one.value)
  }

  let running = 0
  const fallen = [...perInstant]
    .sort((one, other) => one[0] - other[0])
    .map(([at, value]) => {
      running += value
      return { at, millimetres: running }
    })

  return {
    fallen,
    stepMinutes: medianStepOf(fallen.map((one) => one.at)) ?? undefined,
  }
}

/** A class of total the map paints, named by the millimetre it opens at. */
type Shade = { from: number; colour: string }

/**
 * The classes a total is read in on the map, and their blues. Fixed rather than
 * fitted to the replay, so that a blue means the same rain on every replay;
 * blues alone, so that none reads as a threshold's colour.
 */
export const SHADES = [
  { from: 0, colour: '#bfd7ed' },
  { from: 10, colour: '#a9cce5' },
  { from: 50, colour: '#5ba3d0' },
  { from: 100, colour: '#2171b5' },
  { from: 200, colour: '#08306b' },
] as const satisfies readonly Shade[]

/**
 * What a gauge that measured nothing shows: a grey outside the ramp, whose
 * palest blue would say that it did not rain.
 */
export const UNMEASURED = '#9aa7b2'

/** Which class a total falls in, a bound belonging to the class it opens. */
export function shadeOf(millimetres: number): string {
  return (SHADES.findLast((one) => millimetres >= one.from) ?? SHADES[0]).colour
}

/** What one measure of a gauge added, and the span it is read over. */
export type Step = { from: Cursor; at: Cursor; millimetres: number }

/**
 * What each measure added to the running total, and the span it covers: from the
 * measure before it to its own instant, where its total is reached. A measure of
 * zero is kept: the gauge looked, and nothing had fallen.
 *
 * Never one median step back: Aquasys's series are event-driven, and a median
 * span would paint rain on hours it did not fall on. The median serves the first
 * measure alone; without a readable step, it is an instant.
 */
export function stepsOf(gauge: Gauge): Step[] {
  const fallback = readable(gauge.stepMinutes) ? gauge.stepMinutes * 60_000 : 0
  let running = 0
  let previous: Cursor | undefined

  return gauge.fallen.map((one) => {
    const millimetres = one.millimetres - running
    running = one.millimetres
    const from = previous ?? one.at - fallback
    previous = one.at

    return { from, at: one.at, millimetres }
  })
}

/**
 * The floor a scale of bars never goes under, the ramp's first bound: a gauge
 * whose heaviest step was two millimetres must not read as a deluge.
 */
const NEGLIGIBLE = SHADES[1].from

/**
 * What a set of bars is measured against: the heaviest of their steps. A window
 * passes one gauge's steps; the lanes pass the whole parc's, since most gauges
 * hold a single measure and, each on its own scale, would all be drawn full
 * height.
 */
export function scaleOf(steps: readonly Step[]): number {
  return steps.reduce<number>((heaviest, one) => Math.max(heaviest, one.millimetres), NEGLIGIBLE)
}

/** What a bar of a lane says of itself: what fell, and over the gauge's span. */
export function barSaid(millimetres: number, over: string | undefined): string {
  const fell = `${formatValue(millimetres)} ${UNITS.rainfall}`

  return over === undefined ? fell : `${fell} sur ${over}`
}

/** Whether a step is a span: a single measure has none, nor measures too close to tell apart. */
function readable(stepMinutes: number | undefined): stepMinutes is number {
  return stepMinutes !== undefined && stepMinutes > 0
}

/** « 24 heures », « 5 minutes »: hours and minutes, never days; nothing without a span. */
export function spanSaid(stepMinutes: number | undefined): string | undefined {
  if (!readable(stepMinutes)) return undefined

  return stepMinutes >= HOUR ? counted(stepMinutes / HOUR, 'heure') : counted(stepMinutes, 'minute')
}

const rounded = (count: number) => Math.round(count * 10) / 10

/** « 2,5 heures », « 1 heure », « 5 minutes »: one rounding and one agreement for both spans. */
function counted(count: number, unit: string): string {
  const step = rounded(count)

  return `${formatValue(step)} ${unit}${step > 1 ? 's' : ''}`
}
