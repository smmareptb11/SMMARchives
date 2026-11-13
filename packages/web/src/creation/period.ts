import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { toInstant } from '../time.ts'

export type Period = { period: TimeWindow } | { refusal: string }

/**
 * What the two fields amount to, or why they amount to nothing. Nothing here
 * builds a date: the conversion from French time belongs to `time.ts`.
 */
export function periodOf(from: string, to: string, now: number = Date.now()): Period {
  const start = toInstant(from)
  const end = toInstant(to)
  if (start === undefined || end === undefined) {
    return { refusal: 'Un début et une fin sont nécessaires.' }
  }
  // Compared as instants, never as the text typed: two wall times an hour
  // apart can name the same instant the night the clocks change.
  if (Date.parse(end) <= Date.parse(start)) {
    return { refusal: 'La période va du début vers la fin.' }
  }
  // Nothing has been measured yet past now: such a replay would be hollow.
  if (Date.parse(end) > now) {
    return { refusal: 'La fin ne peut pas dépasser l’heure actuelle.' }
  }
  return { period: { from: start, to: end } }
}

const AN_HOUR = 60 * 60 * 1000

/** Past a month, a build runs long and calls the production services hard. */
const LONG_HOURS = 31 * 24

/**
 * What the form says of a period long enough to give pause, without refusing
 * it: a flood can last longer than the longest replay built so far.
 */
export function lengthWarning(from: string, to: string): string | undefined {
  const hours = hoursBetween(from, to)
  return hours !== undefined && hours > LONG_HOURS
    ? 'Une période de plus d’un mois est longue à construire et sollicite fortement les services de production.'
    : undefined
}

/**
 * How long the replay would cover, counted on the instants rather than the
 * calendar: the night the clocks go back is twenty-five hours long.
 */
export function hoursBetween(from: string, to: string): number | undefined {
  const start = toInstant(from)
  const end = toInstant(to)
  if (start === undefined || end === undefined) return undefined
  return Math.round((Date.parse(end) - Date.parse(start)) / AN_HOUR)
}

/**
 * What the end shows as it is opened: what it holds, or else the start, since a
 * date picker left empty opens on today, far from the flood being replayed.
 */
export function endOnOpening(from: string, to: string): string {
  if (to !== '') return to
  return toInstant(from) === undefined ? '' : from
}
