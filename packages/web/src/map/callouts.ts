import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { instantOf, viewAt, type Views } from '../pictures.ts'
import { formatInstant } from '../time.ts'
import type { Cursor } from '../transport/reading.ts'
import { NAMES } from './families.ts'
import type { Kind } from './sources.ts'
import { crossingAt } from './state.ts'

/** What a marker says when it is clicked: a name, and a line or two under it. */
export type Callout = { title: string; lines: string[] }

/**
 * What a measuring source says at the instant being read.
 *
 * A rain gauge says its family and stops: Aquasys bears no threshold on a
 * rainfall quantity, so a line about thresholds would describe a rule that
 * does not exist rather than a calm gauge.
 */
export function calloutOfSource(
  events: readonly ReplayEvent[],
  source: { kind: Kind; id: number; name: string },
  at: Cursor,
): Callout {
  const lines = [NAMES[source.kind].one]
  if (source.kind !== 'rain-gauge') lines.push(...thresholdLines(events, source.id, at))

  return { title: source.name, lines }
}

/**
 * The threshold a station is in, or that it is under all of them.
 *
 * « Under every threshold » is what the replay holds, not what happened: a
 * station whose ladder Aquasys never gave is under nothing and shows the same
 * sentence. Telling the two apart means reading the ladders the replay froze,
 * which this line does not; the map says as much in its legend.
 */
function thresholdLines(events: readonly ReplayEvent[], stationId: number, at: Cursor): string[] {
  const event = crossingAt(events, stationId, at)
  if (event === undefined) return ['Sous tous ses seuils à cet instant.']

  const crossing = event.crossing

  // The lane hatches such a crossing, and the map colours it like any other.
  // Nearly every crossing of a replay rests on a nature nobody read, and a
  // guess shown plainly reads as a fact.
  const assumed = crossing?.natureIsFallback === true ? ['Nature du seuil supposée.'] : []

  // The threshold's own label rather than the event's title, which opens with
  // the station's name — already the heading of the bubble. An event with no
  // crossing behind it is one an agent wrote, and its title is all it has.
  const label = crossing?.label ?? event.title

  // A crossing the water never came out of ends on the last measurement, and
  // the station turns blue after it. Said plainly, or the return to blue reads
  // as a fall that was watched.
  return [
    crossing?.stillActiveAtEnd === true
      ? `${label} — pas redescendue à la dernière mesure du rejeu.`
      : label,
    ...assumed,
  ]
}

/** What a camera says: where it is, and when the picture on the map was taken. */
export function calloutOfCamera(camera: Webcam, views: Views, at: Cursor): Callout {
  const view = viewAt(views, camera.code, at)

  return {
    title: camera.commune,
    lines: [
      'Webcam',
      view === undefined
        ? 'Aucune vue avant cet instant.'
        : `Vue du ${formatInstant(instantOf(view))}.`,
    ],
  }
}
