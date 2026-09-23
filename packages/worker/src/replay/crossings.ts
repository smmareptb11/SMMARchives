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

export type DeriveCrossingsOptions = {
  /** Both families' measures, as the replay stored them. */
  measures: readonly Measure[]
  thresholds: readonly Threshold[]
  /** The hydrological fleet, which is where a threshold's station is found. */
  stations: readonly Station[]
  collector: ReportCollector
}

export type CrossingsResult = {
  events: ReplayEvent[]
  /** Thresholds a nature excludes from producing anything, per nature. */
  setAside: Partial<Record<ThresholdNature, number>>
  /**
   * Crossings that lasted a single measure.
   *
   * Counted because `data` cannot show it: a closed one-measure event is
   * indistinguishable from a two-measure one at an irregular cadence.
   */
  singleStep: number
}

/**
 * Derives the threshold crossings a replay's own data implies.
 *
 * Three rules bind this, and breaking any of them produces a chronology that is
 * false and reads as plausible. Only `alert-level` thresholds produce anything.
 * The instant carried is the observation's, never interpolated. The judgement
 * bears on the value at the instant, never on an accumulation over the episode.
 *
 * Treating the three threshold natures alike would invent a crossing at every
 * historical flood mark, and invert the logic on a drought scale, whose values
 * fall as the situation worsens.
 */
export function deriveCrossings(options: DeriveCrossingsOptions): CrossingsResult {
  const { alertLevels, setAside } = excludeByNature(options.thresholds, options.collector)
  const fleet = new Map(options.stations.map((one) => [one.id, one]))

  const events: ReplayEvent[] = []
  let singleStep = 0

  for (const ladder of ladders(alertLevels).values()) {
    for (const event of walkLadder(ladder, options, fleet)) {
      if (event.crossing.singleStep === true) singleStep += 1
      events.push(event.event)
    }
  }

  return { events, setAside, singleStep }
}

/**
 * Splits the thresholds an alert level from those a nature excludes.
 *
 * A nature the source stated excludes a threshold on its own authority. A
 * nature guessed from a label suppresses a chronology on a guess, and that is
 * what earns a fallback here.
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
 * Walks one ladder against its station's series.
 *
 * Both ways out without an event are reported rather than silent, and through
 * different channels because they are different facts: a threshold naming a
 * station the replay does not hold is a rule that could not be applied, a
 * station that returned nothing is an absence.
 */
/* eslint-disable-next-line max-statements -- the two ways out without an event, each reported
   rather than silent, then one pass */
function walkLadder(
  ladder: readonly Threshold[],
  options: DeriveCrossingsOptions,
  fleet: Map<number, Station>,
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

  const series = seriesOf(options, first.stationId, first.quantity)
  if (series.length === 0) {
    options.collector.withoutData(first.stationId)
    return []
  }

  const produced: Array<{ event: ReplayEvent; crossing: Crossing }> = []
  for (const [rank, threshold] of ladder.entries()) {
    const crossings = cross(series, threshold)

    // Once per threshold, and only where the guess had a consequence: one that
    // crossed nothing changed no chronology, and the classification itself is
    // already in the thresholds report.
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
 * Walks one series against one threshold.
 *
 * Reaching the threshold counts as crossing it — `isOverrunThreshold` and
 * hydrological practice both mean reaching, and measures carry three decimals
 * against a threshold's one or two, so exact equality is ordinary.
 *
 * A hole in the series holds an open event open, on the last value known: that
 * is the only choice that invents nothing, since closing it would assert a fall
 * the source never reported.
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
    severity,
    color: threshold.color,
    from: crossing.from,
    to: crossing.to,
    position: station.position,
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
 * The thresholds of one station and one quantity, by ascending value.
 *
 * The key carries the quantity because a threshold's `id` is unique within a
 * station *and* a quantity, never within a station — station 84 carries two
 * thresholds numbered 1, one on the level and one on the flow. Keyed on the
 * station alone, the two ladders would merge, be ranked against each other, and
 * each be evaluated against the other's series.
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
 * Sorted and de-duplicated rather than trusted: the state machine reads
 * transitions, so an unordered series invents them, and two measures on one
 * instant would give two crossings the same identifier — the id derives from
 * the start.
 *
 * The de-duplication is insurance, not the fix for an observed defect. Nothing
 * establishes that Aquasys can return two measures on one instant: the
 * measurement points of the stations examined carry *different* `typeId`s, so a
 * request on one `dataType` names one point. What leaves the door ajar is that
 * the endpoint takes `codepoint` and `distinctByCodePoint` parameters we do not
 * send, and that `link_pointPrels` has only been read on a handful of stations.
 * Settling it needs a live call on the whole fleet.
 *
 * Instants are compared as time, never as strings: `instantSchema` accepts both
 * second and millisecond precision, and `'.' < 'Z'` would order them wrong.
 *
 * The join is on the identifier and the quantity, and it is the **quantity**
 * that keeps the two families apart: the two number their sources
 * independently, so `sourceId` 4 names a station and a rain gauge, and only the
 * fact that no quantity is collected on both stops one inheriting the other's
 * series. That is a property of `reference/data-types.ts`, not of this
 * function, and it ends the day a quantity is collected on both.
 */
function seriesOf(
  options: DeriveCrossingsOptions,
  sourceId: number,
  quantity: Quantity,
): Measure[] {
  const series = options.measures
    .filter((one) => one.sourceId === sourceId && one.quantity === quantity)
    .sort((a, b) => toEpochMilliseconds(a.at) - toEpochMilliseconds(b.at))

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
