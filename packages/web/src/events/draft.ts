import { isWithin, type Instant, type TimeWindow } from '@smmarchives/shared/clock.ts'
import type { EventPosition } from '@smmarchives/shared/contracts/event.ts'

import { toInstant, toLocalInput } from '../time.ts'

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
  position: EventPosition | null
}

/** What the API is sent, once the draft holds together. */
export type Report = {
  title: string
  producerKind: string
  from: Instant
  to: Instant | null
  description: string | null
  position: EventPosition | null
}

export type Field = 'title' | 'producerKind' | 'from' | 'to' | 'description' | 'position' | 'photos'

export type Refusals = Partial<Record<Field, string>>

/** What a photo is, as far as the rules go: a file without its bytes. */
export type PhotoFile = { size: number; type: string }

/** A blank form, starting where the reading stands: that is the moment the agent stopped on. */
export function draftAt(at: Instant): Draft {
  return {
    title: '',
    producerKind: '',
    from: toLocalInput(at),
    to: '',
    description: '',
    position: null,
  }
}

/**
 * The report a draft amounts to, or what is wrong with it, field by field.
 *
 * The API's own rules, said before sending so that the agent reads them in
 * French and beside the field; the API judges again, and has the last word.
 */
export function judged(
  draft: Draft,
  period: TimeWindow,
  photos: readonly PhotoFile[],
): { report: Report } | { refusals: Refusals } {
  const title = draft.title.trim()
  const producerKind = draft.producerKind.trim()
  const from = toInstant(draft.from)
  const to = draft.to === '' ? null : toInstant(draft.to)

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
    from: refusedStart(from, period),
    to: refusedEnd(to, from, period),
    photos: refusedPhotos(photos),
  })

  if (from === undefined || to === undefined || Object.keys(refusals).length > 0) {
    return { refusals }
  }
  const description = draft.description.trim() === '' ? null : draft.description
  return { report: { title, producerKind, from, to, description, position: draft.position } }
}

/** The refusals that were said, and not the fields that had nothing to say. */
function said(all: Partial<Record<Field, string | undefined>>): Refusals {
  return Object.fromEntries(Object.entries(all).filter(([, one]) => one !== undefined))
}

function tooLong(text: string, max: number, empty: string, long: string): string | undefined {
  if (text === '') return empty
  return text.length > max ? long : undefined
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

function refusedPhotos(photos: readonly PhotoFile[]): string | undefined {
  if (photos.length > PHOTO_COUNT_LIMIT) {
    return `Un événement porte ${String(PHOTO_COUNT_LIMIT)} photos au plus.`
  }
  if (photos.some((one) => !PHOTO_TYPES.includes(one.type))) {
    return 'Une photo est une image JPEG, PNG ou WebP.'
  }
  if (photos.some((one) => one.size > PHOTO_SIZE_LIMIT)) return 'Une photo pèse 15 Mo au plus.'
  return undefined
}

/**
 * Where a refusal of the API lands in the form.
 *
 * Its field when the API named one the form shows, and the foot of the form
 * otherwise: a refusal nobody can place still has to be read.
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

const FIELDS: readonly Field[] = ['title', 'producerKind', 'from', 'to', 'description', 'position']

/** How far after the start an end is first proposed. */
export const PROPOSED_SPAN_MS = 15 * 60_000

/**
 * The end as the agent clicks into it: a quarter of an hour after the start,
 * when there is none yet.
 *
 * An event mostly ends the same day, so the agent adjusts an hour rather than
 * picking a date again from an empty field. On a click and not on reaching the
 * field: tabbing through the form is not asking for an end. Counted on the
 * instant, so a quarter of an hour across the change of clock stays one.
 */
export function endOnEntry(draft: Draft): string {
  if (draft.to !== '') return draft.to
  const from = toInstant(draft.from)
  if (from === undefined) return ''
  return toLocalInput(new Date(Date.parse(from) + PROPOSED_SPAN_MS).toISOString())
}

/** How the form names each field, for a summary that points to them. */
const LABELS: Record<Field, string> = {
  title: 'Titre',
  producerKind: 'Signalé par',
  from: 'Début',
  to: 'Fin',
  description: 'Description',
  position: 'Lieu',
  photos: 'Photos',
}

/**
 * What is left to correct, said beside the button that sends.
 *
 * A refusal sits under its field, which on a small screen is out of sight of
 * the button the agent just pressed: without this, the press seems to do
 * nothing. In the form's own order, so the list reads top to bottom.
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
