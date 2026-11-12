import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { Station } from '@smmarchives/shared/contracts/station.ts'

import { epochOf } from '../time.ts'
import type { Cursor } from '../transport/reading.ts'

/**
 * How long the event last begun stays set apart, in time read: twenty minutes,
 * as the mockup does — long enough to be seen while the reading runs.
 */
const LATEST_MS = 20 * 60 * 1000

/** One line of the history, as the column draws it. */
export type HistoryEntry = {
  id: string
  /** A crossing names its station; what an agent wrote names who said it. */
  kind: 'crossing' | 'report'
  from: string
  /** The threshold for a crossing, the sort of report otherwise. */
  badge: { label: string; colour: string | undefined }
  title: string
  description: string | undefined
  who: string
  /** The first photo of a report, as the replay stores it. */
  photo: string | undefined
  /** A crossing whose threshold nature was assumed rather than read. */
  assumed: boolean
  /** The station a crossing happened at, which its detail opens on. */
  sourceId: number | undefined
  /** The event last begun, set apart for a little while. */
  latest: boolean
  /**
   * Over at the instant read. A crossing still active at the period's end is
   * never over: its end is the last instant measured, not a fall back below.
   */
  over: boolean
}

/**
 * What the history holds at an instant: every event begun by then, crossings
 * and reports alike, oldest first.
 *
 * Cumulative, so it grows as the reading runs and shrinks when it goes back:
 * the history is what had happened by the instant read, not all the replay
 * holds.
 */
export function historyAt(
  events: readonly ReplayEvent[],
  stations: readonly Station[],
  at: Cursor,
): HistoryEntry[] {
  const names = new Map(stations.map((one) => [one.id, one.name]))
  const begun = events
    .filter((one) => epochOf(one.from) <= at)
    .sort((one, other) => epochOf(one.from) - epochOf(other.from) || one.id.localeCompare(other.id))

  return begun.map((one, index) => ({
    ...said(one, names),
    id: one.id,
    from: one.from,
    title: one.title,
    latest: index === begun.length - 1 && at - epochOf(one.from) < LATEST_MS,
    over: one.to !== null && epochOf(one.to) <= at && one.crossing?.stillActiveAtEnd !== true,
  }))
}

type Said = Omit<HistoryEntry, 'id' | 'from' | 'title' | 'latest' | 'over'>

/** What a crossing and a report each say of themselves, which differs. */
function said(event: ReplayEvent, names: ReadonlyMap<number, string>): Said {
  return event.origin === 'automatic' ? crossingSaid(event, names) : reportSaid(event)
}

function crossingSaid(event: ReplayEvent, names: ReadonlyMap<number, string>): Said {
  const station = event.sourceId === null ? undefined : names.get(event.sourceId)
  return {
    kind: 'crossing',
    badge: { label: event.crossing?.label ?? event.title, colour: event.color ?? undefined },
    description: undefined,
    who: station ?? 'Station inconnue',
    photo: undefined,
    assumed: event.crossing?.natureIsFallback === true,
    sourceId: event.sourceId ?? undefined,
  }
}

function reportSaid(event: ReplayEvent): Said {
  const photo = event.media[0]
  const where = event.position === null ? ' · sans lieu' : ''
  return {
    kind: 'report',
    badge: { label: photo === undefined ? 'Témoignage' : 'Photo', colour: undefined },
    description: event.description ?? undefined,
    who: `Signalé par ${event.producerKind ?? 'un agent'}${where}`,
    photo,
    assumed: false,
    sourceId: undefined,
  }
}

/**
 * What is written on a threshold's colour so it reads: dark on a light colour,
 * white on a dark one. A bright yellow takes white badly.
 */
export function inkOn(colour: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour)?.[1]
  if (hex === undefined) return '#ffffff'
  const [red, green, blue] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
  const light = 0.299 * (red ?? 0) + 0.587 * (green ?? 0) + 0.114 * (blue ?? 0)
  return light > 150 ? '#1c2833' : '#ffffff'
}
