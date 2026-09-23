import type { Instant } from '@smmarchives/shared/clock.ts'

/**
 * The interface speaks French time; the API speaks UTC.
 *
 * Every conversion goes through this module, and nowhere else builds a date:
 * `new Date('2019-10-22T06:00')` reads a wall time in the machine's own zone,
 * which is right in Carcassonne, wrong everywhere else, and wrong without
 * saying so.
 */
export const FRENCH_TIME = 'Europe/Paris'

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: FRENCH_TIME,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const READABLE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FRENCH_TIME,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const HOUR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FRENCH_TIME,
  hour: '2-digit',
  minute: '2-digit',
})

/** What Paris was offset by, at that instant, in milliseconds. */
function offsetAt(epoch: number): number {
  const parts = PARTS.formatToParts(new Date(epoch))
  const read = (type: string) => Number(parts.find((one) => one.type === type)?.value ?? '0')
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    // Midnight comes back as 24 in some runtimes, and never as a date of its own.
    read('hour') % 24,
    read('minute'),
    read('second'),
  )
  return asIfUtc - epoch
}

const WALL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

const HALF_A_DAY = 12 * 60 * 60 * 1000

/**
 * A wall time in Paris, as `datetime-local` spells it, as the instant it names.
 *
 * Both offsets in force around it are tried — the one half a day before and the
 * one half a day after, which is the pair a clock change sits between — and an
 * instant is kept only if Paris reads it back as the wall time asked for.
 *
 * **The last Sunday of October, two instants bear the same name**, and this
 * keeps the first: the hour before the change. That Sunday falls in the middle
 * of the season this tool replays, so it is not a case of the calendar's
 * imagination. **The last Sunday of March, one hour never happens**, no
 * instant reads back, and this takes the one that follows it. Neither choice
 * shows on screen, which is why both are written here and in the design.
 */
export function toInstant(local: string): Instant | undefined {
  if (!WALL_TIME.test(local)) return undefined
  const asIfUtc = Date.parse(`${local}:00.000Z`)
  if (Number.isNaN(asIfUtc)) return undefined

  const before = asIfUtc - offsetAt(asIfUtc - HALF_A_DAY)
  const after = asIfUtc - offsetAt(asIfUtc + HALF_A_DAY)
  const named = [before, after].filter((epoch) => asIfUtc - epoch === offsetAt(epoch))

  return new Date(named.length === 0 ? before : Math.min(...named)).toISOString()
}

/** An instant as `datetime-local` wants it back: the French wall time. */
export function toLocalInput(instant: Instant): string {
  const epoch = Date.parse(instant)
  if (Number.isNaN(epoch)) return ''
  // `en-CA` spells a date `2019-10-22`, which is the shape the input reads.
  const [date, time] = PARTS.format(new Date(epoch)).split(', ')
  return `${date ?? ''}T${(time ?? '').slice(0, 5)}`
}

/** A date and an hour, in French, for anything an agent reads. */
export function formatInstant(instant: Instant): string {
  const epoch = Date.parse(instant)
  return Number.isNaN(epoch) ? '' : READABLE.format(new Date(epoch))
}

/** The hour alone, for a ruler where the date is already said. */
export function formatHour(instant: Instant): string {
  const epoch = Date.parse(instant)
  return Number.isNaN(epoch) ? '' : HOUR.format(new Date(epoch))
}
