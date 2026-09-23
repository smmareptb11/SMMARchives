import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { toInstant } from '../time.ts'

export type Period = { period: TimeWindow } | { refusal: string }

/**
 * What the two fields amount to, or why they amount to nothing.
 *
 * Nothing here builds a date: the conversion from French time belongs to
 * `time.ts`, and a second one would be a second answer to the same question.
 */
export function periodOf(from: string, to: string): Period {
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
  return { period: { from: start, to: end } }
}

const AN_HOUR = 60 * 60 * 1000

/**
 * How long the replay would cover, counted on the instants.
 *
 * Counted there rather than on the calendar, because the night the clocks go
 * back is twenty-five hours long and the replay covers all of them.
 */
export function hoursBetween(from: string, to: string): number | undefined {
  const start = toInstant(from)
  const end = toInstant(to)
  if (start === undefined || end === undefined) return undefined
  return Math.round((Date.parse(end) - Date.parse(start)) / AN_HOUR)
}
