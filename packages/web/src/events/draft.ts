import { isWithin, type TimeWindow } from '@smmarchives/shared/clock.ts'
import type { EventProvenance } from '@smmarchives/shared/contracts/event.ts'
import { SMMAR_TERRITORY } from '@smmarchives/shared'
import {
  contains,
  type BoundingBox,
  type Position,
} from '@smmarchives/shared/contracts/geometry.ts'

import type { ManualEventInput } from '../api.ts'
import { instantsOf, toInstant, toLocalInput } from '../time.ts'

/** Who the information came from, as an agent reads it. */
export const PROVENANCES: Record<EventProvenance, string> = {
  smmar: 'Agent SMMAR',
  'river-syndicate': 'Syndicat de rivière',
  municipality: 'Commune',
  'fire-service': 'SDIS',
  individual: 'Particulier',
}

/** The form as it is typed: wall times in French time, nothing parsed yet. */
export type Draft = {
  title: string
  description: string
  from: string
  to: string
  provenance: EventProvenance | ''
  position: Position | null
}

export const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  from: '',
  to: '',
  provenance: '',
  position: null,
}

export type Refusals = Partial<Record<'title' | 'from' | 'to' | 'position', string>>

/** What an event must fall within: the replay's period, and its extent. */
export type Scope = {
  period: TimeWindow
  /** Null is a replay of the whole territory, which is what holds it. */
  extent: BoundingBox | null
}

/**
 * What the form amounts to, or why it amounts to nothing yet.
 *
 * The API checks all of it again and has the last word. This only spares an
 * agent a round trip for what the form can see: a missing title, an hour
 * outside the replay. Nothing here builds a date — `time.ts` does.
 */
export function eventOf(
  draft: Draft,
  scope: Scope,
  offered?: string,
): { event: ManualEventInput } | { refusals: Refusals } {
  const title = draft.title.trim()
  const from = startOf(draft.from, scope.period, offered)
  const to = endOf(draft.to, scope.period, from.instant)
  const placed = placeRefusal(draft.position, scope.extent)

  const refusals: Refusals = {
    ...(title === '' ? { title: 'Le titre est obligatoire.' } : {}),
    ...(from.refusal === undefined ? {} : { from: from.refusal }),
    ...(to.refusal === undefined ? {} : { to: to.refusal }),
    ...(placed === undefined ? {} : { position: placed }),
  }
  if (from.instant === undefined || to.instant === undefined || Object.keys(refusals).length > 0) {
    return { refusals }
  }

  return { event: { ...optionalOf(draft), title, from: from.instant, to: to.instant } }
}

/**
 * Why a place cannot be the event's, or nothing.
 *
 * The map lets an agent click anywhere, and the API refuses a place outside
 * the replay: said here first, in the agent's language.
 */
function placeRefusal(position: Position | null, extent: BoundingBox | null): string | undefined {
  if (position === null || contains(extent ?? SMMAR_TERRITORY, position)) return undefined
  return "L'événement doit être placé dans l'emprise du rejeu."
}

/** What the form may leave empty, empty meaning none. */
function optionalOf(
  draft: Draft,
): Pick<ManualEventInput, 'description' | 'position' | 'provenance'> {
  const description = draft.description.trim()

  return {
    description: description === '' ? null : description,
    position: draft.position,
    provenance: draft.provenance === '' ? null : draft.provenance,
  }
}

type Read<T> = { instant: T; refusal?: undefined } | { instant?: undefined; refusal: string }

/**
 * The instant the start field names, or the instant offered if the agent left
 * it as it was.
 *
 * The field holds a wall time to the minute, and a wall time does not always
 * name the instant it came from: the seconds are gone, and the hour the clocks
 * go back names two instants. The reading's own instant is what was offered,
 * so it is what is kept while the field still says it.
 */
export function startNamed(typed: string, offered: string | undefined): string | undefined {
  return offered !== undefined && typed === toLocalInput(offered) ? offered : toInstant(typed)
}

/**
 * The instant the end field names: in the hour the clocks go back, the first
 * of its two that does not precede the start.
 *
 * An end typed a quarter of an hour after a start taken in the second of those
 * hours means that second hour as well, and read as the first it would end
 * before it began.
 */
export function endNamed(typed: string, from: string | undefined): string | undefined {
  const named = instantsOf(typed)
  if (from === undefined) return named[0]
  return named.find((one) => Date.parse(one) >= Date.parse(from)) ?? named[0]
}

function startOf(typed: string, period: TimeWindow, offered: string | undefined): Read<string> {
  const instant = startNamed(typed, offered)
  if (instant === undefined) return { refusal: 'La date de début est obligatoire.' }
  if (!isWithin(instant, period))
    return { refusal: 'Le début doit tomber dans la période du rejeu.' }
  return { instant }
}

/** No end is an answer — a point in time — where an end nobody can read is not. */
function endOf(typed: string, period: TimeWindow, from: string | undefined): Read<string | null> {
  if (typed === '') return { instant: null }

  const instant = endNamed(typed, from)
  if (instant === undefined) return { refusal: "La date de fin n'est pas lisible." }
  if (!isWithin(instant, period)) return { refusal: 'La fin doit tomber dans la période du rejeu.' }
  if (from !== undefined && Date.parse(instant) < Date.parse(from)) {
    return { refusal: 'La fin ne peut pas précéder le début.' }
  }
  return { instant }
}

/** The formats the API keeps, as a browser names them. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Why an image cannot be sent, or nothing.
 *
 * Asked before the event is created, so that an image the API would refuse
 * never leaves an event behind without it. The type a browser gives is a
 * guess from the name, and the API reads the bytes and has the last word.
 */
export function imageRefusal(
  file: { type: string; size: number },
  limit: number | undefined,
): string | undefined {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Seules les images JPEG, PNG ou WebP sont acceptées.'
  }
  if (limit !== undefined && file.size > limit) {
    return `L'image dépasse la taille autorisée (${megabytes(limit)} Mo au plus).`
  }
  return undefined
}

/** A size as an agent reads it: megabytes, one decimal at most. */
function megabytes(bytes: number): string {
  return String(Math.round((bytes / (1024 * 1024)) * 10) / 10).replace('.', ',')
}

/**
 * Why the API refused an image, in the agent's language.
 *
 * Said from the status, which is the API's answer; its `detail` is written for
 * whoever reads the server's log, in English.
 */
export function imageRefusedSaid(status: number | undefined): string {
  if (status === 413) return 'elle dépasse la taille autorisée.'
  if (status === 415) return "son format n'est pas reconnu (JPEG, PNG ou WebP)."
  return "l'API ne l'a pas acceptée."
}
