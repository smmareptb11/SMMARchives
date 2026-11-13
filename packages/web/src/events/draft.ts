import { isWithin, type Instant, type TimeWindow } from '@smmarchives/shared/clock.ts'
import {
  isWebAddress,
  type EventPosition,
  type ReplayEvent,
} from '@smmarchives/shared/contracts/event.ts'

import { shifted, toInstant, toLocalInput } from '../time.ts'

/**
 * What the API accepts of a photo, said here before a megabyte is sent for
 * nothing. `docs/api.md` holds the rule; the API still judges the bytes.
 */
export const PHOTO_SIZE_LIMIT = 15 * 1024 * 1024
export const PHOTO_COUNT_LIMIT = 10
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Who reports, offered rather than imposed: the field stays free text. */
export const PRODUCER_KINDS = ['Agent SMMAR', 'Syndicat', 'Commune', 'SDIS', 'Particulier']

/** The form as typed: wall times in French time, text as it stands. */
export type Draft = {
  title: string
  producerKind: string
  /** As `datetime-local` spells it. */
  from: string
  /** Empty for an event of no duration. */
  to: string
  description: string
  link: string
  position: EventPosition | null
  /**
   * The instants the hours were filled from. The hour the change of clock
   * names twice is spelled the same both times, and these say which it was.
   */
  near: { from: Instant | undefined; to: Instant | undefined }
}

/** What the API is sent, once the draft holds together. */
export type Report = {
  title: string
  producerKind: string
  from: Instant
  to: Instant | null
  description: string | null
  link: string | null
  position: EventPosition | null
}

type Field =
  'title' | 'producerKind' | 'from' | 'to' | 'description' | 'link' | 'position' | 'photos'

export type Refusals = Partial<Record<Field, string>>

/** What a photo is, as far as the rules go: a file without its bytes. */
type PhotoFile = { size: number; type: string }

/** A blank form, starting where the reading stands: that is the moment the agent stopped on. */
export function draftAt(at: Instant): Draft {
  return {
    title: '',
    producerKind: '',
    from: toLocalInput(at),
    to: '',
    description: '',
    link: '',
    position: null,
    near: { from: at, to: undefined },
  }
}

/** The form filled in with what an event says, to amend it: wall times in French time. */
export function draftOf(event: ReplayEvent): Draft {
  return {
    title: event.title,
    producerKind: event.producerKind ?? '',
    from: toLocalInput(event.from),
    to: event.to === null ? '' : toLocalInput(event.to),
    description: event.description ?? '',
    link: event.link ?? '',
    position: event.position,
    near: { from: event.from, to: event.to ?? undefined },
  }
}

/**
 * The report a draft amounts to, or what is wrong with it, field by field: the
 * API's own rules, said in French beside the field; the API has the last word.
 */
export function judged(
  draft: Draft,
  period: TimeWindow,
  photos: readonly PhotoFile[],
  /** Photos the event already holds and keeps, which count towards the limit. */
  kept = 0,
): { report: Report } | { refusals: Refusals } {
  const title = draft.title.trim()
  const producerKind = draft.producerKind.trim()
  const from = startOf(draft)
  const to = endOf(draft, from)
  const link = linkOf(draft)

  const refusals = said({
    title: tooLong(
      title,
      200,
      'Le titre dit ce qui s’est passé.',
      'Le titre tient en 200 caractères.',
    ),
    producerKind: tooLong(
      producerKind,
      100,
      'Dites qui l’a signalé.',
      'Cette mention tient en 100 caractères.',
    ),
    description:
      draft.description.length > 5_000 ? 'La description tient en 5 000 caractères.' : undefined,
    link: refusedLink(link),
    ...hoursRefused(draft, period),
    photos: refusedPhotos(photos, kept),
  })

  if (from === undefined || to === undefined || Object.keys(refusals).length > 0) {
    return { refusals }
  }
  const description = draft.description.trim() === '' ? null : draft.description
  return { report: { title, producerKind, from, to, description, link, position: draft.position } }
}

/**
 * What is wrong with the start and the end, said as soon as either is picked:
 * an hour outside the replay is refused by the agent's next move, and not by
 * the button at the foot of the form.
 */
export function hoursRefused(draft: Draft, period: TimeWindow): Pick<Refusals, 'from' | 'to'> {
  const from = startOf(draft)
  const to = endOf(draft, from)
  return said({ from: refusedStart(from, period), to: refusedEnd(to, from, period) })
}

function startOf(draft: Draft): Instant | undefined {
  return toInstant(draft.from, draft.near.from)
}

/** Read near the start when nothing filled it: an end mostly follows its start closely. */
function endOf(draft: Draft, from: Instant | undefined): Instant | null | undefined {
  return draft.to === '' ? null : toInstant(draft.to, draft.near.to ?? from)
}

/** The refusals that were said, and not the fields that had nothing to say. */
function said(all: Partial<Record<Field, string | undefined>>): Refusals {
  return Object.fromEntries(Object.entries(all).filter(([, one]) => one !== undefined))
}

function tooLong(text: string, max: number, empty: string, long: string): string | undefined {
  if (text === '') return empty
  return text.length > max ? long : undefined
}

/** The link as typed, trimmed, and none when the field is left empty. */
function linkOf(draft: Draft): string | null {
  const link = draft.link.trim()
  return link === '' ? null : link
}

/** No link at all, or the address of a web page. */
function refusedLink(link: string | null): string | undefined {
  if (link === null) return undefined
  if (link.length > 2_000) return 'Le lien tient en 2 000 caractères.'
  return isWebAddress(link) ? undefined : 'Un lien commence par http:// ou https://.'
}

/** The start, read through the one clock, within the replay's period. */
function refusedStart(from: Instant | undefined, period: TimeWindow): string | undefined {
  if (from === undefined) return 'Le début est une date et une heure.'
  return isWithin(from, period) ? undefined : 'Le début tombe hors de la période du rejeu.'
}

/** No end at all, or one within the period and not before the start. */
function refusedEnd(
  to: Instant | null | undefined,
  from: Instant | undefined,
  period: TimeWindow,
): string | undefined {
  if (to === undefined) return 'La fin est une date et une heure, ou rien.'
  if (to === null) return undefined
  if (!isWithin(to, period)) return 'La fin tombe hors de la période du rejeu.'
  return from !== undefined && Date.parse(to) < Date.parse(from)
    ? 'La fin vient après le début.'
    : undefined
}

function refusedPhotos(photos: readonly PhotoFile[], kept: number): string | undefined {
  if (photos.length + kept > PHOTO_COUNT_LIMIT) {
    return `Un événement porte ${String(PHOTO_COUNT_LIMIT)} photos au plus.`
  }
  if (photos.some((one) => !PHOTO_TYPES.includes(one.type))) {
    return 'Une photo est une image JPEG, PNG ou WebP.'
  }
  if (photos.some((one) => one.size > PHOTO_SIZE_LIMIT)) return 'Une photo pèse 15 Mo au plus.'
  return undefined
}

/**
 * Where a refusal of the API lands in the form: its field when the form shows
 * the one named, the foot of the form otherwise.
 */
export function placed(refusals: readonly { path: string; message: string }[]): {
  fields: Refusals
  rest: string[]
} {
  const fields: Refusals = {}
  const rest: string[] = []
  for (const one of refusals) {
    const field = FIELDS.find((name) => one.path === name || one.path.startsWith(`${name}.`))
    if (field === undefined) rest.push(`${one.path} : ${one.message}`)
    else fields[field] = one.message
  }
  return { fields, rest }
}

const FIELDS: readonly Field[] = [
  'title',
  'producerKind',
  'from',
  'to',
  'description',
  'link',
  'position',
]

/** How far after the start an end is first proposed. */
const PROPOSED_SPAN_MS = 15 * 60_000

/**
 * The end as the agent clicks into it: when there is none, a quarter of an hour
 * after the start, so the agent adjusts an hour rather than picks a date. Only
 * then, since most events last no time; counted on the instant, so it stays a
 * quarter of an hour across the change of clock.
 */
export function endOnEntry(draft: Draft): string {
  if (draft.to !== '') return draft.to
  const from = startOf(draft)
  if (from === undefined) return ''
  return toLocalInput(shifted(from, PROPOSED_SPAN_MS))
}

/** How the form names each field, for a summary that points to them. */
const LABELS: Record<Field, string> = {
  title: 'Titre',
  producerKind: 'Signalé par',
  from: 'Début',
  to: 'Fin',
  description: 'Description',
  link: 'Lien',
  position: 'Lieu',
  photos: 'Photos',
}

/**
 * What is left to correct, in the form's order, said beside the button that
 * sends: on a small screen the refusals under their fields are out of sight, and
 * the press would seem to do nothing.
 */
export function toCorrect(refusals: Refusals): string | undefined {
  const fields = (Object.keys(LABELS) as Field[]).filter((one) => refusals[one] !== undefined)
  return fields.length === 0
    ? undefined
    : `À corriger : ${fields.map((one) => LABELS[one]).join(', ')}.`
}

/** Whether the agent has typed anything a click elsewhere would throw away. */
export function touched(draft: Draft, from: Draft, photos: number): boolean {
  return (
    photos > 0 || (Object.keys(from) as (keyof Draft)[]).some((key) => draft[key] !== from[key])
  )
}
