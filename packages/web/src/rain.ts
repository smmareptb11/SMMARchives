import { UNITS } from '@smmarchives/shared'
import { medianStepOf } from '@smmarchives/shared/clock.ts'
import type { Measure } from '@smmarchives/shared/contracts/measure.ts'

import { formatValue } from './detail/series.ts'
import { lastBefore, type Cursor } from './transport/reading.ts'

const HOUR = 60
const DAY = 24 * HOUR

/** How much had fallen by one of a gauge's instants, counting from the start. */
type Fallen = { at: Cursor; millimetres: number }

/** What one rain gauge holds over the period, which no cursor changes. */
export type Gauge = {
  /** Its running totals, oldest first. */
  fallen: Fallen[]
  /**
   * The median gap between two of its measures, in minutes.
   *
   * Nothing when the gauge holds a single measure, and **zero when two of them
   * share an instant** — Aquasys aligns its dates on five minutes and nothing
   * stops it repeating one. Zero is not a step: whatever reads this has to
   * answer for it, or it writes « toutes les 0 minutes » and draws every bar an
   * instant wide without saying why.
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
  stepMinutes: number | undefined
}

/**
 * The parc's rain, gauge by gauge, with its totals already run up.
 *
 * Worked out once and read at each instant, which is the shape `viewsOf` and
 * `seriesOf` already take: an open bubble asks sixty times a second, and the
 * map is about to ask for two hundred and twenty-nine gauges on those same
 * frames.
 *
 * Totals run up rather than measures kept: a rain gauge gives what fell during
 * a step, where a station gives the water's level at an instant. Two points of
 * five millimetres are ten millimetres of rain, and were never a rise of five.
 *
 * A gauge that measured nothing has no entry, which is what tells it from one
 * that measured zero.
 *
 * The quantity is what keeps this on one family, and what makes an identifier
 * without a family safe here — `seriesOf` filters on it for the same reason,
 * and both stop being safe the day one quantity is collected on both families.
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
    stepMinutes: gauge.stepMinutes,
  }
}

/**
 * One gauge's measures, run up into totals, one entry per instant.
 *
 * Two rows on the same instant are added rather than kept apart. Nothing in the
 * contract forbids them and Aquasys aligns its dates on five minutes, so the
 * pair is reachable; kept apart they give a median gap of zero, two bars drawn
 * on the same pixel, and two marks under one key. Added, they are what the
 * running total already made of them.
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
 * The classes a total is read in on the map, and the blue of each.
 *
 * Fixed, and never stretched over the replay being read. A scale taken from the
 * open replay would always use the whole ramp, but the same blue would mean
 * twenty millimetres on one flood and two hundred on another, and two replays
 * would stop being comparable.
 *
 * Blues alone, sharing nothing with the colours Aquasys gives a threshold: the
 * map carries two languages of colour at once, and a reader must be able to
 * tell which one a marker speaks without remembering a table.
 */
export const SHADES = [
  { from: 0, colour: '#dce9f6' },
  { from: 10, colour: '#a9cce5' },
  { from: 50, colour: '#5ba3d0' },
  { from: 100, colour: '#2171b5' },
  { from: 200, colour: '#08306b' },
] as const satisfies readonly Shade[]

/**
 * What a gauge that measured nothing in the period shows.
 *
 * Outside the ramp on purpose: the palest blue would say « it did not rain »
 * where nothing was measured at all, and the map's own neutral is the blue of a
 * station under every threshold, which says even less.
 */
export const UNMEASURED = '#9aa7b2'

/** Which class a total falls in, a bound belonging to the class it opens. */
export function shadeOf(millimetres: number): string {
  return (SHADES.findLast((one) => millimetres >= one.from) ?? SHADES[0]).colour
}

/**
 * How often a gauge measured, as the bubble says it.
 *
 * Said rather than sorted into « hourly » or « daily ». Aquasys gives those two
 * steps on the floods measured, but also event-driven series whose gaps are
 * five, twenty-five and a hundred and twenty minutes inside the same two days:
 * two classes would have to call one of those a lie, and this is the sentence
 * whose whole job is to stop the figure above it being misread.
 */
export function stepSaid(stepMinutes: number | undefined): string {
  if (stepMinutes === undefined) return 'Une seule mesure sur la période.'
  // Its own sentence rather than the one above: several measures were taken,
  // and what cannot be said is how far apart — not how many there were.
  if (!readable(stepMinutes)) return 'Plusieurs mesures au même instant : pas de pas lisible.'
  if (stepMinutes >= DAY) return every(stepMinutes / DAY, 'tous les', 'jour')
  if (stepMinutes >= HOUR) return every(stepMinutes / HOUR, 'toutes les', 'heure')

  return every(stepMinutes, 'toutes les', 'minute')
}

/** « Une mesure par heure. », or « Une mesure toutes les 2,5 heures. » */
function every(count: number, each: string, unit: string): string {
  return rounded(count) === 1
    ? `Une mesure par ${unit}.`
    : `Une mesure ${each} ${counted(count, unit)}.`
}

/** What one measure of a gauge added, and the span it is read over. */
export type Step = { from: Cursor; at: Cursor; millimetres: number }

/**
 * What each measure put into the running total, and over what span.
 *
 * Read back from the totals rather than kept beside them: the totals are what
 * the map and the bubble already rest on, and a second list of the same figures
 * would let a lane and a bubble disagree about one measure.
 *
 * A measure of zero is one of them. The gauge looked and nothing had fallen,
 * which is not what an absent measure says — and a bar of zero height is still
 * a bar, which is the whole difference the lane has to draw.
 *
 * The span ends on the measure's own instant, because that is where its total
 * is reached: a daily gauge read at 14 h carries hours that fell before, which
 * is what the map's own silences already say.
 *
 * And it begins where the measure before it was taken, never one median step
 * back from it. Aquasys serves event-driven series whose gaps are five, twenty
 * -five and a hundred and twenty minutes inside two days: given the median,
 * their bars overlap and paint rain on hours it did not fall on, which is the
 * one thing this screen exists to get right. The median is the fallback for the
 * first measure alone, which has nothing before it.
 *
 * A gauge whose step cannot be read — one measure, or measures too close to
 * separate — is left a point in time rather than handed a span nobody measured.
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
 * The floor a scale of bars cannot go under, which is the ramp's own first bound.
 *
 * Without it, a gauge whose heaviest step was two millimetres would draw that
 * step at full height and read as a deluge beside the gauge that took a hundred.
 * Read off `SHADES` rather than spelled again: the map stops calling a total
 * negligible at that same millimetre, and two copies would drift apart at the
 * first change of ramp.
 */
const NEGLIGIBLE = SHADES[1].from

/**
 * What a set of bars is measured against: the heaviest step among them.
 *
 * One function, two readings, and the caller chooses which by what it hands in.
 * A bubble passes one gauge's steps, because it carries an axis of figures and
 * a scale that says what it is can show that gauge's episode best. A lane
 * carries no axis and is read against the lane above and the lane below, so the
 * lanes pass the whole parc's steps: given its own scale, a gauge with a single
 * measure draws it full height whatever it measured — and two hundred and ten of
 * the two hundred and fourteen gauges of a whole-parc replay hold exactly one.
 * Two hundred and ten identical bars say nothing; against the parc, a gauge that
 * took two millimetres is a stub beside one that took two hundred.
 *
 * Of the replay and not of the ramp: a replay where nothing passed twenty
 * millimetres would draw every lane as a stub on a scale fixed at two hundred.
 */
export function scaleOf(steps: readonly Step[]): number {
  return steps.reduce<number>((heaviest, one) => Math.max(heaviest, one.millimetres), NEGLIGIBLE)
}

/**
 * What a bar of a lane says of itself: what fell, and over how long.
 *
 * The span is named because the bar draws it: a daily gauge's bar covers half
 * the lane, and a reader has to know that width is one measure and not a day of
 * them. It is handed in already written, because it is the gauge's and not the
 * bar's: a gauge at a five-minute step has two hundred and eighty-nine bars to
 * name, and the same three words for every one of them.
 */
export function barSaid(millimetres: number, over: string | undefined): string {
  const fell = `${formatValue(millimetres)} ${UNITS.rainfall}`

  return over === undefined ? fell : `${fell} sur ${over}`
}

/**
 * Whether a step can be read at all, which no caller may take for granted.
 *
 * The one place the two ways of having none are folded together: a gauge with a
 * single measure gives no gap to measure, and a gauge whose measures share an
 * instant gives one of zero. Neither is a span, and `stepsOf` draws both as the
 * instant they are.
 */
function readable(stepMinutes: number | undefined): stepMinutes is number {
  return stepMinutes !== undefined && stepMinutes > 0
}

/**
 * « 24 heures », « 5 minutes » — hours and minutes, never days: a span is read.
 *
 * Nothing when the gauge gave no step to read: one measure, or measures too
 * close to separate. A span nobody measured is not claimed.
 */
export function spanSaid(stepMinutes: number | undefined): string | undefined {
  if (!readable(stepMinutes)) return undefined

  return stepMinutes >= HOUR ? counted(stepMinutes / HOUR, 'heure') : counted(stepMinutes, 'minute')
}

const rounded = (count: number) => Math.round(count * 10) / 10

/**
 * « 2,5 heures », « 1 heure », « 5 minutes ».
 *
 * The one rule of agreement and the one rounding, for both sentences a gauge
 * says of itself: written twice they disagreed under the minute, which is a gap
 * Aquasys's event-driven series produce.
 */
function counted(count: number, unit: string): string {
  const step = rounded(count)

  return `${formatValue(step)} ${unit}${step > 1 ? 's' : ''}`
}
