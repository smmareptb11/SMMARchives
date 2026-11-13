import {
  toEpochMilliseconds,
  type Instant,
  type Measure,
  type Quantity,
  type ReplayEvent,
  type ReportCollector,
  type Station,
  type Threshold,
  type ThresholdNature,
} from '@smmarchives/shared'

type DeriveCrossingsOptions = {
  /** Both families' measures, as the replay stored them. */
  measures: readonly Measure[]
  thresholds: readonly Threshold[]
  /** The hydrological fleet, which is where a threshold's station is found. */
  stations: readonly Station[]
  collector: ReportCollector
}

type CrossingsResult = {
  events: ReplayEvent[]
  /** Thresholds a nature excludes from producing anything, per nature. */
  setAside: Partial<Record<ThresholdNature, number>>
  /**
   * Crossings that lasted a single measure, which the events alone cannot show
   * at an irregular cadence.
   */
  singleStep: number
}

/**
 * Derives the threshold crossings a replay's own data implies.
 *
 * Three rules, each of which, broken, gives a false chronology that reads as
 * plausible: only `alert-level` thresholds produce anything (a flood mark or a
 * drought scale would not); the instant is the observation's, never
 * interpolated; the value at the instant is judged, never an accumulation.
 */
export function deriveCrossings(options: DeriveCrossingsOptions): CrossingsResult {
  const { alertLevels, setAside } = excludeByNature(options.thresholds, options.collector)
  const fleet = new Map(options.stations.map((one) => [one.id, one]))
  const measured = bySeries(options.measures)

  const events: ReplayEvent[] = []
  let singleStep = 0

  for (const ladder of ladders(alertLevels).values()) {
    for (const event of walkLadder(ladder, options, fleet, measured)) {
      if (event.crossing.singleStep === true) singleStep += 1
      events.push(event.event)
    }
  }

  return { events, setAside, singleStep }
}

/**
 * Splits the alert levels from the thresholds their nature excludes. Only a
 * nature guessed from a label is reported.
 */
function excludeByNature(
  thresholds: readonly Threshold[],
  collector: ReportCollector,
): { alertLevels: Threshold[]; setAside: Partial<Record<ThresholdNature, number>> } {
  const setAside: Partial<Record<ThresholdNature, number>> = {}
  const alertLevels: Threshold[] = []

  for (const threshold of thresholds) {
    if (threshold.nature === 'alert-level') {
      alertLevels.push(threshold)
      continue
    }
    setAside[threshold.nature] = (setAside[threshold.nature] ?? 0) + 1
    if (threshold.natureIsFallback) {
      collector.fellBackTo({
        subject: `station ${threshold.stationId} ${threshold.label}`,
        rule: 'the nature of a threshold is read from the source',
        applied: `inferred ${threshold.nature} from the label, so it produces no crossing`,
      })
    }
  }

  return { alertLevels, setAside }
}

/**
 * Walks one ladder against its station's series. A station the replay does not
 * hold is a rule not applied, a station with no measure an absence: each is
 * reported on its own channel.
 */
/* eslint-disable-next-line max-statements -- the two ways out without an event, each reported
   rather than silent, then one pass */
function walkLadder(
  ladder: readonly Threshold[],
  options: DeriveCrossingsOptions,
  fleet: Map<number, Station>,
  measured: Map<string, Measure[]>,
): Array<{ event: ReplayEvent; crossing: Crossing }> {
  const first = ladder[0]!
  const station = fleet.get(first.stationId)
  if (station === undefined) {
    options.collector.fellBackTo({
      subject: `station ${first.stationId}`,
      rule: 'a threshold belongs to a source of the replay',
      applied: 'no such station in the fleet, so its ladder produced nothing',
    })
    return []
  }

  const series = seriesOf(options, measured, first.stationId, first.quantity)
  if (series.length === 0) {
    options.collector.withoutData(first.stationId)
    return []
  }

  const produced: Array<{ event: ReplayEvent; crossing: Crossing }> = []
  for (const [rank, threshold] of ladder.entries()) {
    const crossings = cross(series, threshold)

    // Only where the guess had a consequence: the thresholds report already holds the guess.
    if (threshold.natureIsFallback && crossings.length > 0) {
      options.collector.fellBackTo({
        subject: `station ${threshold.stationId} ${threshold.label}`,
        rule: 'the nature of a threshold is read from the source',
        applied: `inferred alert-level from the label, and ${crossings.length} crossing(s) rest on it`,
      })
    }

    for (const crossing of crossings) {
      produced.push({
        event: toEvent(crossing, threshold, rank + 1, ladder.length, station),
        crossing,
      })
    }
  }

  return produced
}

type OpenCrossing = { from: Instant; measured: number; peak: number; steps: number }

type Crossing = {
  from: Instant
  to: Instant
  measured: number
  peak: number
  stillActiveAtEnd: boolean
  singleStep: boolean
}

/**
 * Walks one series against one threshold. Reaching it counts as crossing it, as
 * Aquasys's `isOverrunThreshold` means, and equality is ordinary. A hole in the
 * series holds an open event open: closing it would assert a fall nobody measured.
 */
function cross(series: readonly Measure[], threshold: Threshold): Crossing[] {
  const crossings: Crossing[] = []
  let open: OpenCrossing | undefined

  for (const measure of series) {
    if (measure.value >= threshold.value) {
      if (open === undefined) {
        open = { from: measure.at, measured: measure.value, peak: measure.value, steps: 1 }
      } else {
        open.steps += 1
        open.peak = Math.max(open.peak, measure.value)
      }
      continue
    }
    if (open !== undefined) {
      crossings.push(close(open, measure.at, false))
      open = undefined
    }
  }

  if (open !== undefined) {
    // Not null: an event with no end is punctual, and this one is not.
    crossings.push(close(open, series.at(-1)!.at, true))
  }

  return crossings
}

function close(open: OpenCrossing, to: Instant, stillActiveAtEnd: boolean): Crossing {
  return {
    from: open.from,
    to,
    measured: open.measured,
    peak: open.peak,
    stillActiveAtEnd,
    singleStep: open.steps === 1,
  }
}

/* eslint-disable-next-line max-params -- five values an event carries and cannot derive from one
   another */
function toEvent(
  crossing: Crossing,
  threshold: Threshold,
  severity: number,
  ladderHeight: number,
  station: Station,
): ReplayEvent {
  return {
    id: `crossing:${threshold.stationId}:${threshold.quantity}:${threshold.id}:${crossing.from}`,
    origin: 'automatic',
    category: 'threshold-crossing',
    title: `${station.name} — ${threshold.label}`,
    description: null,
    producerKind: null,
    link: null,
    severity,
    color: threshold.color,
    from: crossing.from,
    to: crossing.to,
    position:
      station.position === null
        ? null
        : { type: 'Point', coordinates: [station.position.lon, station.position.lat] },
    sourceId: threshold.stationId,
    media: [],
    crossing: {
      thresholdId: threshold.id,
      label: threshold.label,
      quantity: threshold.quantity,
      value: threshold.value,
      measured: crossing.measured,
      peak: crossing.peak,
      ladderHeight,
      natureIsFallback: threshold.natureIsFallback,
      stillActiveAtEnd: crossing.stillActiveAtEnd,
    },
  }
}

/**
 * The measures by source and quantity, gathered in one pass: walked once per
 * ladder instead, a whole fleet's measures are read hundreds of times over.
 */
function bySeries(measures: readonly Measure[]): Map<string, Measure[]> {
  const grouped = new Map<string, Measure[]>()
  // A crossing joins the hydro fleet and nothing else.
  for (const measure of measures) {
    if (measure.family !== 'hydro') continue
    const key = `${measure.sourceId}:${measure.quantity}`
    const series = grouped.get(key)
    if (series === undefined) grouped.set(key, [measure])
    else series.push(measure)
  }
  return grouped
}

/**
 * The thresholds of one station and one quantity, by ascending value. Keyed on
 * the quantity too: a threshold's `id` is unique only within a station *and* a
 * quantity, and a station can number a level and a flow threshold both 1.
 */
function ladders(thresholds: readonly Threshold[]): Map<string, Threshold[]> {
  const grouped = new Map<string, Threshold[]>()
  for (const threshold of thresholds) {
    const key = `${threshold.stationId}:${threshold.quantity}`
    const ladder = grouped.get(key)
    if (ladder === undefined) grouped.set(key, [threshold])
    else ladder.push(threshold)
  }
  for (const ladder of grouped.values()) ladder.sort((a, b) => a.value - b.value)
  return grouped
}

/**
 * One station's series for one quantity, by instant, one measure per instant.
 *
 * Sorted and de-duplicated rather than trusted: an unordered series invents
 * transitions, and two measures on one instant would give two crossings one
 * identifier. Nobody has seen Aquasys send two, but nothing rules it out.
 *
 * Instants are compared as time, never as strings: `instantSchema` accepts both
 * second and millisecond precision, and `'.' < 'Z'` would order them wrong.
 */
function seriesOf(
  options: DeriveCrossingsOptions,
  measured: Map<string, Measure[]>,
  sourceId: number,
  quantity: Quantity,
): Measure[] {
  const series = [...(measured.get(`${sourceId}:${quantity}`) ?? [])].sort(
    (a, b) => toEpochMilliseconds(a.at) - toEpochMilliseconds(b.at),
  )

  const kept: Measure[] = []
  let previous: number | undefined
  let dropped = 0
  for (const measure of series) {
    const at = toEpochMilliseconds(measure.at)
    if (at === previous) {
      dropped += 1
      continue
    }
    kept.push(measure)
    previous = at
  }
  if (dropped > 0) {
    options.collector.fellBackTo({
      subject: `station ${sourceId} ${quantity}`,
      rule: 'one measure per instant, since a crossing is identified by its start',
      applied: `${dropped} measure(s) on an instant already seen were dropped`,
    })
  }

  return kept
}
