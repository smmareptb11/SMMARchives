import type { Instant, TimeWindow } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { RadarRainfallSeries } from '@smmarchives/shared/contracts/radar-rainfall.ts'
import type { RainGauge, Station } from '@smmarchives/shared/contracts/station.ts'
import type { Threshold } from '@smmarchives/shared/contracts/threshold.ts'
import type { FrozenWebcamImage, Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { instantOf, viewsOf, type View } from '../pictures.ts'
import { barSaid, scaleOf, spanSaid, stepsOf, type Gauges, type Step } from '../rain.ts'
import { instantAt, type Cursor } from '../transport/reading.ts'

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
  webcams: Webcam[]
  images: FrozenWebcamImage[]
  series: RadarRainfallSeries[]
}

/** Where something sits on the ruler, in percent of the period. */
export type Place = { left: number; width: number }

export type Mark = Place & {
  /** When it happened, for a screen that says every hour in French time. */
  at: Instant
  /** What it is, when the instant alone does not say: a crossing's title. */
  label?: string | undefined
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
}

export type Lane = {
  id: string
  label: string
  marks: Mark[]
  /** Its marks tile: each holds until the next, and the lane reads as a strip. */
  filmstrip?: boolean
  /** Its marks are bars standing on the floor of the lane, each one a measure. */
  bars?: boolean
}

export type Family = {
  id: string
  label: string
  lanes: Lane[]
  /** How many sources of this family hold no lane, and why there is none. */
  silent?: number
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
 * period, and its caller passes that end. The two used to share a `null` with
 * two meanings, and the lane and the map then disagreed about one event.
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
  const began = Math.max(from, bounds.start)
  const ended = Math.min(to, bounds.ends)

  const left = ((began - bounds.start) / bounds.span) * 100
  return { left, width: Math.max(((ended - began) / bounds.span) * 100, A_POINT_IN_TIME) }
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
 * The marks a lane draws, which is not always all of them, nor in their order.
 *
 * Spacing exists because a frame costs a file: a replay of 24 hours holds 1 537
 * webcam images. A bar costs nothing of the sort, and dropping one would drop a
 * measure — which is the one thing a lane of bars is there to show. An hourly
 * gauge spaced out like a strip loses half of its day.
 *
 * `barsOf` has already laid them widest first, an order they keep.
 */
export function drawnMarks(lane: Lane, minGap: number): Mark[] {
  if (lane.bars === true) return lane.marks
  return lane.filmstrip === true ? tiled(lane.marks, minGap) : spacedOut(lane.marks, minGap)
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
 * the replay has nothing on that source over the period — for a station it means
 * no threshold was crossed, which is not the same as no measure, and is why the
 * switch says so beside itself.
 *
 * What the reader asked is applied above, by `speaking`: the parc is then built
 * once per replay instead of once per click on a checkbox, which on a gauge at a
 * five-minute step is sixty thousand bars rebuilt to filter a list.
 */
export function lanesOf(content: ReplayContent): Family[] {
  const families: Family[] = []

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
      })),
    })
  }

  push(
    families,
    familyOf('rain-gauge', 'Pluviomètres', rainLanes(content), content.rainGauges.length),
  )

  // A replay older than Ceneau's month of retention holds its cameras and not
  // one picture. Left out, the screen would read as a replay with no webcam.
  push(families, familyOf('webcam', 'Webcams', webcamLanes(content), content.webcams.length))

  push(families, familyOf('radar', "Lames d'eau", radarLanes(content), 0))

  return families
}

/**
 * The lanes of a family that have something to show, which is what is drawn.
 *
 * The family itself stays whatever is left of it: a reader who cut nothing off
 * and found no « Stations cours d'eau » at all would read the replay as holding
 * none. What is missing is counted beside its heading instead.
 */
export function speaking(family: Family): Lane[] {
  return family.lanes.filter((one) => one.marks.length > 0)
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

/** How many of the replay's crossings rest on a nature nobody read. */
export function assumedCrossings(content: ReplayContent): number {
  return content.events.filter((one) => one.crossing?.natureIsFallback === true).length
}

function crossingsOf(content: ReplayContent, sourceId: number): Mark[] {
  return content.events
    .filter((one) => one.sourceId === sourceId)
    .map((one) => ({
      ...placeOf(content.period, one.from, one.to ?? one.from),
      at: one.from,
      label: one.title,
      ...(one.crossing?.natureIsFallback === true ? { assumed: true } : {}),
      color: one.color ?? undefined,
    }))
}

function webcamLanes(content: ReplayContent): Lane[] {
  const views = viewsOf(content.images)

  // Every camera the replay watched, and not only those it came back with a
  // picture of: a lane with no frame says the camera was there and nothing was
  // copied, which its absence would not say. Whether it is drawn is the
  // switch's business, and `lanesOf` answers that for every family at once.
  const codes = [...new Set([...content.webcams.map((one) => one.code), ...views.keys()])].sort()

  return codes.map((code) => ({
    id: `webcam-${code}`,
    label: content.webcams.find((one) => one.code === code)?.commune ?? code,
    filmstrip: true,
    marks: framesOf(content.period, views.get(code) ?? []),
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
    marks: barsOf(bounds, steps.get(gauge.id) ?? [], rain.get(gauge.id)?.stepMinutes, scale),
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
function barsOf(
  bounds: Bounds,
  steps: readonly Step[],
  stepMinutes: number | undefined,
  scale: number,
): Mark[] {
  const over = spanSaid(stepMinutes)

  return steps
    .map((step) => ({
      ...placedIn(bounds, step.from, step.at),
      at: instantAt(step.at),
      label: barSaid(step.millimetres, over),
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
    marks: series.frames
      .map((frame) => ({ ...placeOf(content.period, frame.at, frame.at), at: frame.at }))
      .sort((one, other) => one.left - other.left),
  }))
}
