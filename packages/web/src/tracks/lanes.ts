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
   * The parc's rain, gauge by gauge, or nothing when the replay holds none.
   *
   * Run up once here rather than at each reader: the map asks what two hundred
   * and twenty-nine gauges had measured on every frame, and an open bubble asks
   * the same of one of them on those same frames.
   *
   * Nothing, and never an empty map. A data set nobody collected and one
   * collected empty hold the same nothing, and only the manifest tells them
   * apart — as the API's own route does before refusing. A gauge with no entry
   * measured nothing; no rain at all means nothing is known of it, and the
   * screen must not say the first where it means the second.
   */
  rain: Gauges | undefined
  /**
   * The stations holding at least one measure over the period: their measures
   * are not loaded, and a lane with no crossing on it says nothing of them.
   *
   * Nothing, and never an empty set, when the replay does not hold the list —
   * for the reason `rain` gives: no station is known to have measured nothing.
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
   * The nature of the threshold behind it was assumed, not read.
   *
   * A ladder carrying neither `category` nor `isOverrunThreshold` has its
   * nature guessed from the label; a drought ladder read as an alert one fires
   * on an ordinary flow. The replay records the guess, and the screen shows it,
   * or a guess reads as a fact.
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
  /**
   * Its marks sample a record that runs on — a picture every few minutes — so
   * a few of them stand for the rest, and they are spaced out. A strip is one.
   */
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

/**
 * A dot on the ruler is not a duration, and a lane of them is unreadable.
 *
 * Everything is placed in percent of the period: a lane knows dates, never
 * pixels, so it stays right whatever width it is drawn at.
 */
const A_POINT_IN_TIME = 0.4

/**
 * Where something sits, from an instant to an instant.
 *
 * Both ends are named, and neither is guessed. A crossing with no end is a
 * point in time and ends where it began — the contract says so, and the map
 * reads it the same way; a picture with no successor runs to the end of the
 * period, and its caller passes that end. The lane and the map so read one
 * event the same way.
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

/**
 * The same, from two instants already read as numbers.
 *
 * A gauge at a five-minute step puts two hundred and eighty-nine bars on one
 * lane, and a whole parc sixty thousand: written back out as dates for this to
 * parse them again, they cost seventy times what the arithmetic does.
 */
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

/**
 * How wide a bar has to be for the seam between it and the next to leave it
 * any colour, in percent of the period: ten pixels or so on a lane of the usual
 * width. A seam on a bar of two pixels is half the bar.
 */
const SEAM_LEAST = 1

/**
 * Where a bar of rain sits: over its own span, however narrow.
 *
 * Bars follow each other edge to edge, each beginning where the measure before
 * it was taken, so none covers another as long as each keeps its width. Widened
 * to a point in time, the bars of a gauge at a five-minute step would each
 * cover the next few, and the lane would draw rain that was never measured
 * there. Only a bar left with no width is widened, by the lane: a lone measure,
 * which has no span, or one taken on the period's first instant, whose span
 * lies wholly before it.
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
 * The marks a lane can show without turning into a smear.
 *
 * A replay of 24 hours holds 1 537 webcam images. Drawn whole on a lane a
 * thousand pixels wide, each would be a pixel, and the browser would fetch
 * 1 537 files to render one. The first and the last are always kept, so a lane
 * still says when it begins and when it ends.
 */
export function spacedOut<T extends { left: number }>(marks: T[], minGap: number): T[] {
  const kept: T[] = []
  for (const mark of marks) {
    const last = kept.at(-1)
    if (last === undefined || mark.left - last.left >= minGap) kept.push(mark)
  }
  return withTheLastOne(kept, marks.at(-1), minGap)
}

/**
 * A lane says when it ends, whatever the spacing.
 *
 * The final mark is kept even when the gap left it out — and it takes the
 * place of the one before it when they would touch: two marks against each
 * other say less than one at the end.
 */
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
 * The marks a lane draws: every one of them, unless they are samples.
 *
 * A crossing, a measure or what an agent wrote is a fact, and dropping one
 * hides it — a crisis that began twenty minutes after another would vanish
 * under the alert it rose from. Samples are spaced out instead, because they
 * are many and stand for one another: a replay of 24 hours holds 1 537 webcam
 * images, and each frame drawn costs a file.
 *
 * The marks keep the order they were given: `barsOf` lays bars widest first.
 */
export function drawnMarks(lane: Lane, minGap: number): Mark[] {
  if (lane.filmstrip === true) return tiled(lane.marks, minGap)
  return lane.sampled === true ? spacedOut(lane.marks, minGap) : lane.marks
}

/**
 * The frames of a filmstrip, spaced out and tiled again.
 *
 * Each frame was given the span up to the picture that followed it; spacing
 * then drops some of those pictures, and every survivor ends where a frame
 * nobody draws was to begin. Stretched to the next one kept, the frames tile
 * edge to edge and the lane reads as a strip rather than a row of slivers. The
 * last one keeps its span, which already runs to the end of the period.
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
 * What a replay holds, as families of lanes.
 *
 * Every source keeps its lane, whatever the reader asked. An empty lane means
 * the replay has nothing to draw of that source over the period — for a station,
 * no threshold crossed, which is why its lane also says whether it measured.
 *
 * What the reader asked is applied above, by `speaking`: the parc is then built
 * once per replay instead of once per click on a checkbox, which on a gauge at a
 * five-minute step is sixty thousand bars rebuilt to filter a list.
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

  // A replay older than Ceneau's month of retention holds its cameras and not
  // one picture. Left out, the screen would read as a replay with no webcam.
  push(families, familyOf('webcam', 'Webcams', webcamLanes(content), content.webcams.length))

  push(families, familyOf('radar', "Lames d'eau", radarLanes(content), 0))

  // Products of one delivery rather than sources, which no name orders.
  return families.map((one) => (one.id === 'radar' ? one : { ...one, lanes: byLabel(one.lanes) }))
}

/**
 * The lanes of a family that have something to show, which is what is drawn: a
 * mark, or a source that measured.
 *
 * The family itself stays whatever is left of it: a reader who cut nothing off
 * and found no « Stations cours d'eau » at all would read the replay as holding
 * none. What is missing is counted beside its heading instead.
 */
export function speaking(family: Family): Lane[] {
  return family.lanes.filter((one) => one.marks.length > 0 || one.measured === true)
}

/**
 * A lane whose source measured and crossed nothing over the period, which the
 * reader may fold away family by family: a valley of « aucun franchissement »
 * buries the few stations that did cross.
 */
export function isQuiet(lane: Lane): boolean {
  return lane.measured === true && lane.marks.length === 0
}

/**
 * What an empty lane says, and whether that is a finding or a gap.
 *
 * A station that measured and crossed nothing is a finding: the water stayed
 * under its thresholds. A source that measured nothing, or a camera nothing was
 * copied of, is a gap in the data, and reads apart from it: told the same
 * words, a reader takes a station that was silent for one that stayed calm.
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
 * A family, unless the replay holds nothing of it at all.
 *
 * One with sources and no lane is kept and counted: an absence tells a reader
 * nothing, where a count tells them what is there and has nothing to show.
 *
 * Judged on the lanes and never on their marks. A family whose lanes are all
 * empty is the switch's business — collapsed here it would be held back with no
 * count on the switch, so the switch would vanish and nothing could bring two
 * hundred and fourteen gauges back.
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

/**
 * What agents reported, on a lane of its own.
 *
 * Nothing when they reported nothing: a family of one empty lane would say the
 * replay holds a kind of source it does not.
 */
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

  // Every camera the replay watched, and not only those it came back with a
  // picture of: a lane with no frame says the camera was there and nothing was
  // copied, which its absence would not say. Whether it is drawn is the
  // switch's business, and `lanesOf` answers that for every family at once.
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
 * The frames of a strip: each view up to the one that follows it.
 *
 * The last runs to the end of the period, because what a camera showed at an
 * instant is what it showed until it looked again. Ceneau shoots twice a day at
 * rest and every quarter of an hour once the water rises, so the strip thickens
 * exactly where the episode is.
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
 * The parc's rain, one lane of bars per gauge.
 *
 * Nothing at all when the replay carries no rain: a lane per gauge with not one
 * bar on it would accuse two hundred and twenty-nine gauges of having measured
 * nothing, where nothing is known of any of them. The family's own count says
 * it instead.
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
 * One bar per measure, over the span it was gathered on.
 *
 * A measure of zero keeps its bar: the gauge looked and nothing had fallen,
 * and that is not the absence a missing bar would draw.
 *
 * Widest first, because the bars overlap: a daily gauge's step covers the whole
 * period, and the measure taken on the period's first instant covers hours
 * before it and is a sliver at the very left. Left in their own order, that
 * sliver is buried under the wide one, and a bar nobody can see is exactly what
 * an absence looks like. An order, not a drawing — so it is settled once here
 * rather than at every render of the lane.
 */
function barsOf(bounds: Bounds, steps: readonly Step[], scale: number): Mark[] {
  return steps
    .map((step) => ({
      ...barPlaceIn(bounds, step),
      // Its own span and not the gauge's step: after a gap in the measures, a
      // bar covers the whole gap.
      label: barSaid(step.millimetres, spanSaid((step.at - step.from) / 60_000)),
      // Never under nothing: a negative increment is a bad reading, and there is
      // no height below the floor of a lane to draw it at. The figure the tooltip
      // carries stays the one the gauge gave.
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
