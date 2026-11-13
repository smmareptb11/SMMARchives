/* eslint-disable max-lines -- every family's lanes are laid out here, from one content and on one
   set of rules; split, a family's lane would be built away from the rules that place it */
import type { Instant, TimeWindow } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { RadarRainfallSeries } from '@smmarchives/shared/contracts/radar-rainfall.ts'
import type { RainGauge, Station } from '@smmarchives/shared/contracts/station.ts'
import type { Threshold } from '@smmarchives/shared/contracts/threshold.ts'
import type { FrozenWebcamImage, Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { reportsOf, rowsOf } from '../events/reports.ts'
import type { Pointed } from '../map/pointed.ts'
import { instantOf, viewsOf, type View } from '../pictures.ts'
import { barSaid, scaleOf, spanSaid, stepsOf, type Gauges, type Step } from '../rain.ts'
import { instantAt, type Cursor } from '../transport/reading.ts'
import { crossingCaption } from './crossing.ts'
import { byLabel } from './order.ts'

/** What the screen loads of a replay. The measures of a station are not among it. */
export type ReplayContent = {
  period: TimeWindow
  stations: Station[]
  rainGauges: RainGauge[]
  events: ReplayEvent[]
  /** The ladders the build froze, which say what a station is watched on. */
  thresholds: Threshold[]
  /**
   * The parc's rain, gauge by gauge, run up once for every reader. Nothing, never
   * an empty map, when the replay holds none: a gauge with no entry is one that
   * measured nothing, where no rain at all means nothing is known.
   */
  rain: Gauges | undefined
  /**
   * The stations holding at least one measure over the period, whose measures
   * are not loaded. Nothing, never an empty set, when the replay does not hold
   * the list, for the reason `rain` gives.
   */
  measuredStations: ReadonlySet<number> | undefined
  webcams: Webcam[]
  images: FrozenWebcamImage[]
  series: RadarRainfallSeries[]
}

/** Where something sits on the ruler, in percent of the period. */
export type Place = { left: number; width: number }

export type Mark = Place & {
  /** When it happened, for a screen that says every hour in French time. */
  at: Instant
  /** What it is, when the instant alone does not say: a report's title. */
  label?: string | undefined
  /** All a mark says of itself, its lane's name and its instant included: a crossing's. */
  caption?: string | undefined
  /**
   * The nature of the threshold behind it was guessed from its label, not read:
   * shown, or a guess reads as a fact.
   */
  assumed?: boolean | undefined
  color?: string | undefined
  /** How tall a bar stands, in percent of the lane. Bars only. */
  height?: number | undefined
  /** The frozen medium a frame draws: the reduction, when the replay holds one. */
  path?: string | undefined
  /** The full image behind a frame, fetched only when someone asks to see it. */
  full?: string | undefined
  /** The event an agent reported that this mark opens. */
  report?: string | undefined
  /** Which row of its lane it is drawn on, when the lane holds several. */
  row?: number | undefined
  /** A bar with no span inside the period, which the lane widens to be seen at all. */
  instant?: boolean | undefined
  /** A bar wide enough for the seam that tells it from the next one. */
  seam?: boolean | undefined
}

export type Lane = {
  id: string
  label: string
  marks: Mark[]
  /** Its marks tile: each holds until the next, and the lane reads as a strip. */
  filmstrip?: boolean
  /** Its marks sample a record that runs on, a few standing for the rest. A strip is one. */
  sampled?: boolean
  /** Its marks are bars standing on the floor of the lane, each one a measure. */
  bars?: boolean
  /** How many rows its marks are spread over, so that none covers another. */
  rows?: number
  /**
   * Its source measured over the period, which the lane says even with no mark
   * on it: a station measured and crossing nothing is not one without data.
   */
  measured?: boolean
  /** Where its source stands on the map, which resting the pointer on it lights up. */
  pointed?: Pointed
}

export type Family = {
  id: string
  label: string
  lanes: Lane[]
  /** How many sources of this family hold no lane, and why there is none. */
  silent?: number
  /**
   * What its heading counts, when that is not its lanes: what agents reported
   * fits on one lane, and « 1 » beside it would read as one report.
   */
  count?: number
}

/** The least width of a mark, in percent of the period: a lane of dots is unreadable. */
const A_POINT_IN_TIME = 0.4

/**
 * Where something sits, from an instant to an instant. Neither end is guessed:
 * the caller passes both, so that the lane and the map read one event alike.
 */
export function placeOf(period: TimeWindow, from: Instant, to: Instant): Place {
  return placedIn(boundsOf(period), Date.parse(from), Date.parse(to))
}

/** The period as the arithmetic wants it, read once for a whole lane of marks. */
export type Bounds = { start: Cursor; ends: Cursor; span: number }

export function boundsOf(period: TimeWindow): Bounds {
  const start = Date.parse(period.from)
  const ends = Date.parse(period.to)

  return { start, ends, span: ends - start }
}

/** The same, from instants already read as numbers: a parc's bars are too many for dates. */
export function placedIn(bounds: Bounds, from: Cursor, to: Cursor): Place {
  const place = spanIn(bounds, from, to)

  return { ...place, width: Math.max(place.width, A_POINT_IN_TIME) }
}

/** Where something sits, exactly as wide as it lasts, however narrow that is. */
function spanIn(bounds: Bounds, from: Cursor, to: Cursor): Place {
  const began = Math.max(from, bounds.start)
  const ended = Math.min(to, bounds.ends)

  return {
    left: ((began - bounds.start) / bounds.span) * 100,
    width: Math.max(((ended - began) / bounds.span) * 100, 0),
  }
}

/** How wide a bar has to be, in percent of the period, for a seam not to eat it. */
const SEAM_LEAST = 1

/**
 * Where a bar of rain sits: over its own span, however narrow. Widened to a
 * point in time, close bars would cover one another and draw rain nobody
 * measured; only a bar with no width at all is left for the lane to widen.
 */
export function barPlaceIn(bounds: Bounds, step: { from: Cursor; at: Cursor }): Mark {
  const place = spanIn(bounds, step.from, step.at)

  return {
    ...place,
    at: instantAt(step.at),
    ...(place.width > 0 ? {} : { instant: true }),
    ...(place.width >= SEAM_LEAST ? { seam: true } : {}),
  }
}

/**
 * The marks a lane can show without turning into a smear. The first and the last
 * are always kept, so that the lane still says when it begins and ends.
 */
export function spacedOut<T extends { left: number }>(marks: T[], minGap: number): T[] {
  const kept: T[] = []
  for (const mark of marks) {
    const last = kept.at(-1)
    if (last === undefined || mark.left - last.left >= minGap) kept.push(mark)
  }
  return withTheLastOne(kept, marks.at(-1), minGap)
}

/** The last mark, kept whatever the spacing, in place of the one before it if they would touch. */
function withTheLastOne<T extends { left: number }>(
  kept: T[],
  last: T | undefined,
  minGap: number,
): T[] {
  const previous = kept.at(-1)
  if (last === undefined || previous === undefined || previous === last) return kept
  if (last.left - previous.left < minGap) kept.pop()
  return [...kept, last]
}

/**
 * The marks a lane draws: every one of them, unless they are samples. A crossing,
 * a measure or a report is a fact, and dropping one hides it; samples stand for
 * one another, and each frame drawn costs a file.
 *
 * The marks keep the order they were given: `barsOf` lays bars widest first.
 */
export function drawnMarks(lane: Lane, minGap: number): Mark[] {
  if (lane.filmstrip === true) return tiled(lane.marks, minGap)
  return lane.sampled === true ? spacedOut(lane.marks, minGap) : lane.marks
}

/**
 * The frames of a filmstrip, spaced out, each stretched to the next one kept: a
 * frame's span ends where the next picture began, which spacing may have dropped.
 */
export function tiled(marks: Mark[], minGap: number): Mark[] {
  const kept = spacedOut(marks, minGap)

  return kept.map((mark, index) => {
    const next = kept[index + 1]
    return next === undefined ? mark : { ...mark, width: next.left - mark.left }
  })
}

const STATION_FAMILIES = [
  { id: 'watercourse', label: "Stations cours d'eau" },
  { id: 'structure', label: 'Ouvrages' },
] as const

/**
 * What a replay holds, as families of lanes. Every source keeps its lane, empty
 * or not: what the reader asked is applied above, by `speaking`, so that the parc
 * is built once per replay rather than once per click on a checkbox.
 */
export function lanesOf(content: ReplayContent): Family[] {
  const families: Family[] = []

  // First, being what an agent added to what the sources said.
  push(families, reportFamily(content))

  for (const family of STATION_FAMILIES) {
    const stations = content.stations.filter((one) => one.category === family.id)
    if (stations.length === 0) continue
    families.push({
      id: family.id,
      label: family.label,
      lanes: stations.map((station) => ({
        id: `station-${String(station.id)}`,
        label: station.name,
        marks: crossingsOf(content, station.id),
        measured: content.measuredStations?.has(station.id) === true,
        pointed: { source: family.id, id: station.id },
      })),
    })
  }

  const gauges = rainLanes(content)
  push(families, familyOf('rain-gauge', 'Pluviomètres', gauges, content.rainGauges.length))

  // Past Ceneau's retention, a replay holds its cameras and not one picture.
  push(families, familyOf('webcam', 'Webcams', webcamLanes(content), content.webcams.length))

  push(families, familyOf('radar', "Lames d'eau", radarLanes(content), 0))

  // Products of one delivery rather than sources, which no name orders.
  return families.map((one) => (one.id === 'radar' ? one : { ...one, lanes: byLabel(one.lanes) }))
}

/**
 * The lanes of a family that have something to show: a mark, or a source that
 * measured. The family itself stays, what is missing counted beside its heading:
 * gone, it would read as a replay holding none.
 */
export function speaking(family: Family): Lane[] {
  return family.lanes.filter((one) => one.marks.length > 0 || one.measured === true)
}

/**
 * A lane whose source measured and crossed nothing over the period, which the
 * reader may fold away, or a valley of them buries the few stations that crossed.
 */
export function isQuiet(lane: Lane): boolean {
  return lane.measured === true && lane.marks.length === 0
}

/**
 * What an empty lane says, and whether that is a gap in the data rather than a
 * finding: told the same words, a silent station reads as one that stayed calm.
 */
export function emptyOf(lane: Lane): { said: string; gap: boolean } | undefined {
  if (lane.marks.length > 0) return undefined
  if (lane.measured === true) return { said: 'aucun franchissement sur la période', gap: false }
  if (lane.filmstrip === true || lane.sampled === true) {
    return { said: 'aucune image sur la période', gap: true }
  }
  return { said: 'aucune mesure sur la période', gap: true }
}

/** How many lanes the switch is holding back, over every family at once. */
export function heldIn(families: readonly Family[]): number {
  return families.reduce((total, one) => total + one.lanes.length - speaking(one).length, 0)
}

/**
 * A family, unless the replay holds nothing of it: one with sources and no lane
 * is kept and counted. Judged on the lanes, never on their marks: a family of
 * empty lanes collapsed here would take with it the switch that brings them back.
 */
function familyOf(id: string, label: string, lanes: Lane[], sources: number): Family | undefined {
  if (lanes.length > 0) return { id, label, lanes }
  return sources > 0 ? { id, label, lanes: [], silent: sources } : undefined
}

function push(families: Family[], family: Family | undefined): void {
  if (family !== undefined) families.push(family)
}

function crossingsOf(content: ReplayContent, sourceId: number): Mark[] {
  return content.events
    .filter((one) => one.sourceId === sourceId)
    .map((one) => ({
      ...placeOf(content.period, one.from, one.to ?? one.from),
      at: one.from,
      caption: crossingCaption(one),
      ...(one.crossing?.natureIsFallback === true ? { assumed: true } : {}),
      color: one.color ?? undefined,
    }))
}

/** What agents reported, on a lane of its own, and no family when they reported nothing. */
function reportFamily(content: ReplayContent): Family | undefined {
  const reports = reportsOf(content.events)
  if (reports.length === 0) return undefined

  const placed = reports.map((one) => ({
    one,
    place: placeOf(content.period, one.from, one.to ?? one.from),
  }))
  const rows = rowsOf(placed.map(({ place }) => place))
  const marks = placed.map(({ one, place }, index) => ({
    ...place,
    at: one.from,
    label: one.title,
    report: one.id,
    row: rows[index],
  }))

  return {
    id: 'report',
    label: 'Événements saisis',
    count: reports.length,
    lanes: [{ id: 'report', label: 'Saisie manuelle', marks, rows: Math.max(...rows) + 1 }],
  }
}

function webcamLanes(content: ReplayContent): Lane[] {
  const views = viewsOf(content.images)

  // Every camera the replay watched, pictures or not: a lane with no frame says
  // nothing was copied, which an absent lane would not.
  const codes = [...new Set([...content.webcams.map((one) => one.code), ...views.keys()])]

  return codes.map((code) => ({
    id: `webcam-${code}`,
    label: content.webcams.find((one) => one.code === code)?.commune ?? code,
    filmstrip: true,
    marks: framesOf(content.period, views.get(code) ?? []),
    // A camera known by its pictures alone stands nowhere on the map.
    ...(content.webcams.some((one) => one.code === code) ? { pointed: { camera: code } } : {}),
  }))
}

/**
 * The frames of a strip: each view up to the one that follows it, the last to
 * the end of the period. A camera shows what it showed until it looks again.
 */
function framesOf(period: TimeWindow, views: readonly View[]): Mark[] {
  return views.map((view, index) => {
    const at = instantOf(view)
    const next = views[index + 1]

    return {
      ...placeOf(period, at, next === undefined ? period.to : instantOf(next)),
      at,
      path: view.path,
      full: view.full,
    }
  })
}

/**
 * The parc's rain, one lane of bars per gauge, and none when the replay carries
 * no rain: empty lanes would say each gauge measured nothing.
 */
function rainLanes(content: ReplayContent): Lane[] {
  const rain = content.rain
  if (rain === undefined) return []

  const steps = new Map([...rain].map(([id, gauge]) => [id, stepsOf(gauge)]))
  const scale = scaleOf([...steps.values()].flat())
  const bounds = boundsOf(content.period)

  return content.rainGauges.map((gauge) => ({
    id: `rain-gauge-${String(gauge.id)}`,
    label: gauge.name,
    bars: true,
    marks: barsOf(bounds, steps.get(gauge.id) ?? [], scale),
    pointed: { source: 'rain-gauge', id: gauge.id },
  }))
}

/**
 * One bar per measure, zero included, over the span it was gathered on. Widest
 * first, because bars can overlap: a narrow one drawn under a wide one would read
 * as an absence.
 */
function barsOf(bounds: Bounds, steps: readonly Step[], scale: number): Mark[] {
  return steps
    .map((step) => ({
      ...barPlaceIn(bounds, step),
      // Its own span and not the gauge's step: after a gap in the measures, a
      // bar covers the whole gap.
      label: barSaid(step.millimetres, spanSaid((step.at - step.from) / 60_000)),
      // A negative increment is a bad reading, drawn on the floor; the label keeps
      // the figure the gauge gave.
      height: (Math.max(step.millimetres, 0) / scale) * 100,
    }))
    .sort((one, other) => other.width - one.width)
}

function radarLanes(content: ReplayContent): Lane[] {
  return content.series.map((series) => ({
    id: `radar-${series.delivery}-${series.product}`,
    label: series.product,
    sampled: true,
    marks: series.frames
      .map((frame) => ({ ...placeOf(content.period, frame.at, frame.at), at: frame.at }))
      .sort((one, other) => one.left - other.left),
  }))
}
