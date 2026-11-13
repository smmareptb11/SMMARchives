import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { RainGauge, Station } from '@smmarchives/shared/contracts/station.ts'

import { stationsWithoutMeasures } from '../mutes.ts'
import { rainAt, shadeOf, UNMEASURED, type Gauges } from '../rain.ts'
import { epochOf } from '../time.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { keyOf, kindOf, prefixOf, type Kind } from './sources.ts'

/** What a source shows while it is under every threshold it has. */
export const NEUTRAL = '#1e6bb8'

/**
 * The colour of every station that is not neutral at this instant; an absent
 * one is neutral. Keyed by the source's key — `watercourse:4`, not `4` — so that
 * a station's colour cannot reach the rain gauge sharing its number. No rain
 * gauge: Aquasys gives no threshold on rainfall.
 */
export function coloursAt(
  events: readonly ReplayEvent[],
  stations: readonly Station[],
  at: Cursor,
): Map<string, string> {
  const crossed = crossingsAt(events, at)
  const colours = new Map<string, string>()

  for (const station of stations) {
    const colour = crossed.get(station.id)?.color
    if (colour != null) colours.set(keyOf(kindOf(station.category), station.id), colour)
  }
  return colours
}

/**
 * Everything the map paints at an instant, keyed by source: a threshold's colour
 * on the hydro fleet, a class of rainfall on the gauges.
 */
export function paintedAt(content: ReplayContent, at: Cursor): Map<string, string> {
  const colours = coloursAt(content.events, content.stations, at)
  for (const [key, colour] of unmeasuredColours(content.stations, content.measuredStations)) {
    colours.set(key, colour)
  }
  for (const [key, colour] of rainColoursAt(content.rainGauges, content.rain, at)) {
    colours.set(key, colour)
  }

  return colours
}

/**
 * The stations that measured nothing, in the gauges' grey: the neutral blue
 * would say they were measured. None when the replay does not say which
 * measured. Such a station crosses nothing, so the grey never hides a threshold.
 */
function unmeasuredColours(
  stations: readonly Station[],
  measured: ReadonlySet<number> | undefined,
): Map<string, string> {
  const unmeasured = stationsWithoutMeasures(stations, measured)

  return new Map(
    stations
      .filter((one) => unmeasured.has(one.id))
      .map((one) => [keyOf(kindOf(one.category), one.id), UNMEASURED]),
  )
}

/**
 * What every rain gauge of the parc shows at this instant, each one named: left
 * out, a gauge would wear the stations' neutral blue. None when the replay holds
 * no rain at all, which says the rain was not read, not that every gauge
 * measured nothing.
 */
export function rainColoursAt(
  parc: readonly RainGauge[],
  gauges: Gauges | undefined,
  at: Cursor,
): Map<string, string> {
  if (gauges === undefined) return new Map()

  return new Map(
    parc.map((one) => {
      const gauge = gauges.get(one.id)

      return [
        keyOf('rain-gauge', one.id),
        gauge === undefined ? UNMEASURED : shadeOf(rainAt(gauge, at).millimetres),
      ]
    }),
  )
}

/**
 * What one repaint of a family needs: one branch per colour in play, and what
 * the rest shows.
 */
export function paintingOf(
  kind: Kind,
  colours: Map<string, string>,
): { branches: { colour: string; keys: string[] }[]; fallback: string } {
  const keysByColour = new Map<string, string[]>()
  const prefix = prefixOf(kind)

  // Pushed rather than spread: repaints follow the transport frame by frame, and
  // spreading would copy every list at each key.
  for (const [key, colour] of colours) {
    if (!key.startsWith(prefix)) continue

    const held = keysByColour.get(colour)
    if (held === undefined) keysByColour.set(colour, [key])
    else held.push(key)
  }

  return {
    branches: [...keysByColour].map(([colour, keys]) => ({ colour, keys })),
    fallback: NEUTRAL,
  }
}

/** The crossing each station is in at an instant, gathered in one pass. */
function crossingsAt(events: readonly ReplayEvent[], at: Cursor): Map<number, ReplayEvent> {
  const byStation = new Map<number, ReplayEvent>()

  for (const event of events) {
    if (event.sourceId === null || !holds(event, at)) continue
    byStation.set(event.sourceId, higher(byStation.get(event.sourceId), event))
  }
  return byStation
}

/**
 * The higher of two crossings of one station, the first when they tie; one the
 * source gave no rank sits at the bottom. A rank compares within one station,
 * never across two.
 */
function higher(held: ReplayEvent | undefined, one: ReplayEvent): ReplayEvent {
  if (held === undefined) return one
  return (one.severity ?? 0) > (held.severity ?? 0) ? one : held
}

/**
 * A crossing with no end covers its instant alone: read as lasting to the end of
 * the period, it would paint a station red for a fact that lasted a second.
 */
function holds(event: ReplayEvent, at: Cursor): boolean {
  const from = epochOf(event.from)
  return at >= from && at <= (event.to === null ? from : epochOf(event.to))
}
