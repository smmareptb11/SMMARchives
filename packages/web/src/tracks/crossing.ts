import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { formatInstant } from '../time.ts'

/** Said of a crossing whose threshold the source left untyped, wherever it is shown. */
export const ASSUMED_NATURE =
  'La source ne précise pas si ce seuil est une alerte de crue, un seuil de sécheresse ou un repère de crue : ce type a été déduit.'

/**
 * What a crossing says of itself where its station is already named: the
 * threshold, when the measure reached it and when it fell back under, then
 * what is uncertain of it.
 *
 * The end is the first measure back under the threshold, or the last measure
 * of all when none came back: then the crossing is said to hold still.
 */
export function crossingCaption(event: ReplayEvent): string {
  const reached = `Seuil « ${event.crossing?.label ?? event.title} » atteint le ${formatInstant(event.from)}`
  const sentences = [`${reached}${endOf(event)}.`]
  if (event.crossing?.natureIsFallback === true) sentences.push(ASSUMED_NATURE)
  return sentences.join(' ')
}

function endOf(event: ReplayEvent): string {
  if (event.to === null) return ''
  const at = formatInstant(event.to)
  return event.crossing?.stillActiveAtEnd === true
    ? ` ; toujours atteint à la dernière mesure, le ${at}`
    : ` ; repassé en dessous le ${at}`
}
