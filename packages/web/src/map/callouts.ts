import type { Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { instantOf, viewAt, type Views } from '../pictures.ts'
import { formatInstant } from '../time.ts'
import type { Cursor } from '../transport/reading.ts'
import { NAMES } from './families.ts'
import type { Kind } from './sources.ts'

/** What a marker says when it is clicked: a name, and a line or two under it. */
type Callout = { title: string; lines: string[] }

/** What a measuring source says: its name, and its family under it. */
export function calloutOfSource(source: { kind: Kind; name: string }): Callout {
  return { title: source.name, lines: [NAMES[source.kind].one] }
}

/**
 * A camera the replay froze no view of. It was copied as the camera stands
 * today, and one with a view of the period at least existed then.
 */
const UNSEEN =
  'Aucune image dans ce rejeu. Position et état d’aujourd’hui : rien n’indique que cette caméra existait à la date du rejeu.'

/** What a camera says: where it is, and when the picture on the map was taken. */
export function calloutOfCamera(camera: Webcam, views: Views, at: Cursor): Callout {
  if ((views.get(camera.code) ?? []).length === 0) {
    return { title: camera.commune, lines: ['Webcam', UNSEEN] }
  }
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
