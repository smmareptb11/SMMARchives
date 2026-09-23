import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { RainGauge, Station } from '@smmarchives/shared/contracts/station.ts'

import { rainAt, shadeOf, UNMEASURED, type Gauges } from '../rain.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { keyOf, kindOf, prefixOf, type Kind } from './sources.ts'

/** What a source shows while it is under every threshold it has. */
export const NEUTRAL = '#1e6bb8'

/**
 * The colour of every source that is not neutral at this instant.
 *
 * Keyed by the source's own key — `watercourse:4`, not `4` — for the reason
 * `map/sources.ts` gives: an identifier alone does not name a source. A key
 * carries the family, so a colour meant for a station cannot reach the rain
 * gauge that shares its number. The rule is the shape of the map, and not a
 * clause someone has to remember.
 *
 * Rain gauges never appear: Aquasys gives no threshold on rainfall, so nothing
 * produces a crossing on one. Their own colours come from `rainColoursAt`, and
 * `paintedAt` is where the two meet.
 *
 * A source absent is neutral. What changed is small — a handful of entries
 * against three hundred sources — and it is rebuilt on every tick.
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
 * Everything the map paints at an instant, in the one map of keys it reads.
 *
 * Two languages of colour in a single answer — a threshold's colour on the
 * hydro fleet, a class of rainfall on the gauges — and they cannot reach each
 * other's sources: a key carries its family, and the two families number their
 * own sources independently.
 */
export function paintedAt(content: ReplayContent, at: Cursor): Map<string, string> {
  const colours = coloursAt(content.events, content.stations, at)
  for (const [key, colour] of rainColoursAt(content.rainGauges, content.rain, at)) {
    colours.set(key, colour)
  }

  return colours
}

/**
 * What every rain gauge of the parc shows at this instant.
 *
 * Every one of them, where `coloursAt` names only the stations that left the
 * neutral: a gauge left out would fall back on that neutral, which is the blue
 * of a station under every threshold and belongs to the other language.
 *
 * Unless the replay knows no rain at all — then no gauge has a colour, and they
 * keep the neutral. A build whose Aquasys lane failed still serves its stations
 * and its map, and greying the parc would accuse two hundred and twenty-nine
 * gauges of having measured nothing. That is what an absent `rain` says, where
 * a gauge missing from a present one measured nothing.
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
 * The crossing one station is in at an instant, which is the one it shows.
 *
 * By station identifier, so the caller answers for the family: the two Aquasys
 * families number their sources independently, and a rain gauge carrying a
 * station's identifier would be handed that station's alert. Nothing on a rain
 * gauge ever crosses today, and this is the reason it is not an argument.
 */
export function crossingAt(
  events: readonly ReplayEvent[],
  stationId: number,
  at: Cursor,
): ReplayEvent | undefined {
  let held: ReplayEvent | undefined

  // The station's own events, and not the parc's map read once for one entry:
  // an open bubble asks this on every frame of the reading.
  for (const event of events) {
    if (event.sourceId === stationId && holds(event, at)) held = higher(held, event)
  }
  return held
}

/**
 * What one repaint of a family needs: its branches, and what the rest shows.
 *
 * Here rather than beside the layers, because it decides and does not draw.
 * Grouped by colour because a colour is shared by every source that reaches it,
 * so an episode with three levels in play makes three branches and not
 * ninety-four, and two hundred and twenty-nine rain gauges make at most six.
 */
export function paintingOf(
  kind: Kind,
  colours: Map<string, string>,
): { branches: { colour: string; keys: string[] }[]; fallback: string } {
  const keysByColour = new Map<string, string[]>()
  const prefix = prefixOf(kind)

  // Pushed onto the list held rather than spread into a new one: at six colours
  // over two hundred and twenty-nine gauges, spreading copies some eight
  // thousand entries per repaint, and a repaint falls on one frame in six at
  // the fastest speed of the transport.
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

/**
 * What each station is showing at an instant, gathered in one pass.
 *
 * One definition of « the crossing a station is in », for the colour of the
 * whole parc and for the one source a reader clicked: two passes over the same
 * events would be two answers to keep alike.
 */
function crossingsAt(events: readonly ReplayEvent[], at: Cursor): Map<number, ReplayEvent> {
  const byStation = new Map<number, ReplayEvent>()

  for (const event of events) {
    if (event.sourceId === null || !holds(event, at)) continue
    byStation.set(event.sourceId, higher(byStation.get(event.sourceId), event))
  }
  return byStation
}

/**
 * The higher of two crossings of one station, and the first one when they tie.
 *
 * A rank compared across one station's ladders is meaningful, which is what
 * lets the highest win; a rank compared across stations is not, and nothing
 * here compares two stations. A crossing the source gave no rank sits at the
 * bottom rather than above a Crise.
 */
function higher(held: ReplayEvent | undefined, one: ReplayEvent): ReplayEvent {
  if (held === undefined) return one
  return (one.severity ?? 0) > (held.severity ?? 0) ? one : held
}

/**
 * A crossing with no end is a point in time, and covers that instant alone.
 *
 * Nothing derived produces one today — a crossing the water never came out of
 * closes on the last measurement, and says so through `stillActiveAtEnd`. The
 * case belongs to the manual events to come, and reading it as « until the end
 * of the period » would paint a station red for a fact that lasted a second.
 */
function holds(event: ReplayEvent, at: Cursor): boolean {
  const from = Date.parse(event.from)
  return at >= from && at <= (event.to === null ? from : Date.parse(event.to))
}
