import type { Instant, TimeWindow } from '@smmarchives/shared/clock.ts'

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

const DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FRENCH_TIME,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const DAY_OF_MONTH = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FRENCH_TIME,
  day: '2-digit',
  month: '2-digit',
})

const HOUR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FRENCH_TIME,
  hour: '2-digit',
  minute: '2-digit',
})

const MONTH = new Intl.DateTimeFormat('fr-FR', { timeZone: FRENCH_TIME, month: 'long' })

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
 * keeps the one nearest `near` — the instant a field was filled from, which a
 * wall time alone cannot tell apart from the hour before — and, without one,
 * the first: the hour before the change. That Sunday falls in the middle of
 * the season this tool replays, so it is not a case of the calendar's
 * imagination. **The last Sunday of March, one hour never happens**, no
 * instant reads back, and this takes the one that follows it. Neither choice
 * shows on screen, which is why both are written here and in the design.
 */
export function toInstant(local: string, near?: Instant): Instant | undefined {
  if (!WALL_TIME.test(local)) return undefined
  const asIfUtc = Date.parse(`${local}:00.000Z`)
  if (Number.isNaN(asIfUtc)) return undefined

  const before = asIfUtc - offsetAt(asIfUtc - HALF_A_DAY)
  const after = asIfUtc - offsetAt(asIfUtc + HALF_A_DAY)
  const named = [before, after].filter((epoch) => asIfUtc - epoch === offsetAt(epoch))
  if (named.length === 0) return new Date(before).toISOString()

  const reference = near === undefined ? Number.NaN : Date.parse(near)
  const kept = Number.isNaN(reference)
    ? Math.min(...named)
    : named.reduce((best, one) =>
        Math.abs(one - reference) < Math.abs(best - reference) ? one : best,
      )
  return new Date(kept).toISOString()
}

/** An instant as `datetime-local` wants it back: the French wall time. */
export function toLocalInput(instant: Instant): string {
  const epoch = Date.parse(instant)
  if (Number.isNaN(epoch)) return ''
  // `en-CA` spells a date `2019-10-22`, which is the shape the input reads.
  const [date, time] = PARTS.format(new Date(epoch)).split(', ')
  return `${date ?? ''}T${(time ?? '').slice(0, 5)}`
}

const MINUTE = 60 * 1000

/**
 * The first whole minute at or after an instant, as `datetime-local` wants it.
 *
 * Where a field may start: written to the minute, an instant of 10:30:45 would
 * read 10:30, a moment before it — and the field would offer an hour that is
 * not allowed.
 */
export function toLocalInputFrom(instant: Instant): string {
  const epoch = Date.parse(instant)
  if (Number.isNaN(epoch)) return ''
  return toLocalInput(new Date(Math.ceil(epoch / MINUTE) * MINUTE).toISOString())
}

const EPOCHS = new Map<Instant, number>()

/**
 * An instant as milliseconds since the epoch, read once per instant.
 *
 * What the map and the history ask of every event on every frame: parsed each
 * time, a few thousand crossings cost tens of thousands of parses a second.
 * The instants are a replay's own, so the cache holds no more than it does.
 */
export function epochOf(instant: Instant): number {
  let epoch = EPOCHS.get(instant)
  if (epoch === undefined) {
    epoch = Date.parse(instant)
    EPOCHS.set(instant, epoch)
  }
  return epoch
}

/** The instant a duration after another. */
export function shifted(instant: Instant, milliseconds: number): Instant {
  return new Date(Date.parse(instant) + milliseconds).toISOString()
}

/** A date and an hour, in French, for anything an agent reads. */
export function formatInstant(instant: Instant): string {
  const epoch = Date.parse(instant)
  return Number.isNaN(epoch) ? '' : READABLE.format(new Date(epoch))
}

/**
 * What a wall time typed in is read as, when that is not what was typed: an
 * hour the change of clock skips, the last Sunday of March. Nothing otherwise,
 * as the field already says it.
 */
export function readBack(local: string): string | undefined {
  const instant = toInstant(local)
  if (instant === undefined || toLocalInput(instant) === local) return undefined
  return `Heure sautée par le passage à l’heure d’été : ${formatInstant(instant)} retenu.`
}

/** The date alone, for a clock that writes the hour apart. */
export function formatDate(instant: Instant): string {
  const epoch = Date.parse(instant)
  return Number.isNaN(epoch) ? '' : DATE.format(new Date(epoch))
}

/** The day and the month, for a ruler graduated in days. */
export function formatDay(instant: Instant): string {
  const epoch = Date.parse(instant)
  return Number.isNaN(epoch) ? '' : DAY_OF_MONTH.format(new Date(epoch))
}

/** The hour it is in Paris at an instant, from 0 to 23. */
export function hourOf(instant: Instant): number | undefined {
  const epoch = Date.parse(instant)
  if (Number.isNaN(epoch)) return undefined
  const hour = PARTS.formatToParts(new Date(epoch)).find((one) => one.type === 'hour')?.value
  // Midnight comes back as 24 in some runtimes.
  return hour === undefined ? undefined : Number(hour) % 24
}

/** The hour alone, for a ruler where the date is already said. */
export function formatHour(instant: Instant): string {
  const epoch = Date.parse(instant)
  return Number.isNaN(epoch) ? '' : HOUR.format(new Date(epoch))
}

/**
 * When something happened, seen from the instant being read: the hour alone on
 * the same day, `à 14:00`, and its day with it otherwise, `le 22/10 à 14:00` —
 * a measure taken before the instant may be the day before's.
 */
export function formatSince(instant: Instant, reading: Instant): string {
  const hour = `à ${formatHour(instant)}`
  return formatDate(instant) === formatDate(reading) ? hour : `le ${formatDay(instant)} ${hour}`
}

/**
 * A period in a sentence, as one says it: `du 21 au 27 janvier 2020`, or
 * `le 7 février 2020 de 12 h à 13 h` for less than a day.
 *
 * Days alone from a day on, an end at midnight being the last of the day
 * before: what runs to midnight on the 13th covers nothing of the 13th. The
 * year is always said, once when both ends share it.
 */
export function formatPeriod(period: TimeWindow): string {
  const from = Date.parse(period.from)
  const to = Date.parse(period.to)
  if (Number.isNaN(from) || Number.isNaN(to)) return ''
  const start = wallOf(from)

  if (to + offsetAt(to) - (from + offsetAt(from)) >= DAY_MS) {
    const end = wallOf(to)
    return daysBetween(start, end.hour + end.minute === 0 ? wallOf(to - 1) : end)
  }
  const end = wallOf(to)
  if (end.hour + end.minute === 0) return `le ${dateOf(start)} de ${hourIn(start)} à minuit`
  if (end.date === start.date) return `le ${dateOf(start)} de ${hourIn(start)} à ${hourIn(end)}`
  return `du ${dateOf(start, end)} ${hourIn(start)} au ${dateOf(end)} ${hourIn(end)}`
}

/** A wall time of Paris, in the pieces a sentence reads. */
type Wall = { date: string; day: number; month: string; year: string; hour: number; minute: number }

function wallOf(epoch: number): Wall {
  const parts = PARTS.formatToParts(new Date(epoch))
  const read = (type: string) => parts.find((one) => one.type === type)?.value ?? ''
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    day: Number(read('day')),
    month: MONTH.format(new Date(epoch)),
    year: read('year'),
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
  }
}

/** The days a period covers, each part said once when both ends share it. */
function daysBetween(first: Wall, last: Wall): string {
  if (first.date === last.date) return `le ${dateOf(first)}`
  if (first.year !== last.year) return `du ${dateOf(first)} au ${dateOf(last)}`
  if (first.month !== last.month) return `du ${dateOf(first, last)} au ${dateOf(last)}`
  return `du ${dayIn(first)} au ${dateOf(last)}`
}

/** `7 février 2020`, its year left to the other end when it shares it. */
function dateOf(wall: Wall, other?: Wall): string {
  const day = `${dayIn(wall)} ${wall.month}`
  return other !== undefined && other.year === wall.year ? day : `${day} ${wall.year}`
}

function dayIn(wall: Wall): string {
  return wall.day === 1 ? '1er' : String(wall.day)
}

function hourIn(wall: Wall): string {
  const hour = `${String(wall.hour)} h`
  return wall.minute === 0 ? hour : `${hour} ${String(wall.minute).padStart(2, '0')}`
}

const HOUR_MS = 60 * MINUTE
const DAY_MS = 24 * HOUR_MS

/**
 * How long a period lasts on a Paris clock: `3 jours`, `2 jours 6 h`, `18 h 30`.
 *
 * Measured between wall times rather than instants, so that midnight to
 * midnight three days later reads `3 jours` even across a clock change, which
 * the season this tool replays straddles.
 */
export function formatDuration(period: TimeWindow): string {
  const from = Date.parse(period.from)
  const to = Date.parse(period.to)
  if (Number.isNaN(from) || Number.isNaN(to)) return ''
  const wall = to + offsetAt(to) - (from + offsetAt(from))
  const days = Math.floor(wall / DAY_MS)
  const hours = Math.floor((wall % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((wall % HOUR_MS) / MINUTE)

  const parts: string[] = []
  if (days > 0) parts.push(days === 1 ? '1 jour' : `${days} jours`)
  if (hours > 0)
    parts.push(minutes > 0 ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${hours} h`)
  else if (minutes > 0) parts.push(`${minutes} min`)
  return parts.join(' ')
}
