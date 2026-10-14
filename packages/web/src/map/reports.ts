import type { ExpressionSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { reportsOf } from '../events/reports.ts'
import { MUTED, REPORT } from '../palette.ts'
import type { Cursor } from '../transport/reading.ts'

/**
 * How long a report with no end stays green.
 *
 * Green for its instant alone, it would be green on no frame of a reading at
 * speed: the map steps over it. Fifteen minutes is a few frames at the fastest
 * speed, and short enough not to be read as a duration.
 */
export const POINT_HELD_MS = 15 * 60_000

/** Not yet reported, under way, or over: the map draws nothing, green, then grey. */
export type Phase = 'before' | 'during' | 'after'

export function phaseAt(report: ReplayEvent, at: Cursor): Phase {
  const from = Date.parse(report.from)
  const to = report.to === null ? from + POINT_HELD_MS : Date.parse(report.to)

  if (at < from) return 'before'
  return at <= to ? 'during' : 'after'
}

/** What agents reported somewhere, as the map draws it: a spot, or an area. */
export function reportsOnTheMap(events: readonly ReplayEvent[]): FeatureCollection {
  const features: Feature[] = reportsOf(events).flatMap((one) =>
    one.position === null
      ? []
      : [
          {
            type: 'Feature',
            geometry: one.position,
            properties: { report: one.id },
          },
        ],
  )

  return { type: 'FeatureCollection', features }
}

/** Which reports the map shows at an instant, and which of them are still under way. */
export type ReportPainting = { during: string[]; after: string[] }

export function reportPaintingAt(events: readonly ReplayEvent[], at: Cursor): ReportPainting {
  const painting: ReportPainting = { during: [], after: [] }

  for (const one of reportsOf(events)) {
    if (one.position === null) continue
    const phase = phaseAt(one, at)
    if (phase !== 'before') painting[phase].push(one.id)
  }
  return painting
}

/**
 * Whether two paintings draw the same thing.
 *
 * The reports come in one order on every frame, so their lists compare as
 * they are.
 */
export function samePainting(one: ReportPainting, other: ReportPainting): boolean {
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id, index) => id === b[index])
  return same(one.during, other.during) && same(one.after, other.after)
}

/** The reports of one shape the map draws at an instant: the others are not reported yet. */
export function reportFilterOf(
  painting: ReportPainting,
  shape: 'Point' | 'Polygon',
): ExpressionSpecification {
  return [
    'all',
    ['==', ['geometry-type'], shape],
    ['in', ['get', 'report'], ['literal', [...painting.during, ...painting.after]]],
  ]
}

/** Green while under way, grey once over: a fact that was, rather than one that is. */
export function reportColourOf(painting: ReportPainting): string | ExpressionSpecification {
  if (painting.during.length === 0) return MUTED
  return ['match', ['get', 'report'], painting.during, REPORT, MUTED]
}

type DrawnFeature = { properties: Record<string, unknown> | null }

/**
 * The report under a pointer, if any.
 *
 * Read here because it is written here: the property is the one
 * `reportsOnTheMap` put on the feature.
 */
export function reportUnder(features: readonly DrawnFeature[]): string | undefined {
  for (const feature of features) {
    const report = feature.properties?.report
    if (typeof report === 'string') return report
  }
  return undefined
}

/** What a click on the map is about: a report, a source, or nothing. */
export type Clicked<Source> = { report: string } | { source: Source } | undefined

/**
 * Which of what lies under a click the reader meant.
 *
 * A diamond before a source, wherever the two stand on the same spot: what an
 * agent placed on a station is what they came to say about it. An area after
 * them, or a flooded plain would leave every station inside it unclickable.
 */
export function clickedOf<Source>(under: {
  spot: string | undefined
  source: Source | undefined
  area: string | undefined
}): Clicked<Source> {
  if (under.spot !== undefined) return { report: under.spot }
  if (under.source !== undefined) return { source: under.source }
  return under.area === undefined ? undefined : { report: under.area }
}
