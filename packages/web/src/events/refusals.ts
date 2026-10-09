import { ApiError, describe, type ApiProblem } from '../problems.ts'

/** The fields of an event, as the form names them. */
const FIELDS: Record<string, string> = {
  title: 'Titre',
  description: 'Description',
  from: 'Début',
  to: 'Fin',
  provenance: 'Provenance',
  position: 'Localisation',
  'position.lon': 'Localisation',
  'position.lat': 'Localisation',
}

/** What the API says of a field, as an agent reads it. */
const MESSAGES: Record<string, string> = {
  'must not be empty': 'est obligatoire',
  'must be an instant': "n'est pas une date lisible",
  'ends before it starts': 'ne peut pas précéder le début',
  'must fall within the period of the replay': 'doit tomber dans la période du rejeu',
  'must fall within the extent of the replay': "doit tomber dans l'emprise du rejeu",
  'must not carry control characters': 'contient des caractères non autorisés',
  'is not a field of this request': "n'est pas un champ attendu",
}

/**
 * Why the API refused an event, in the agent's language.
 *
 * Its `detail` is written for whoever reads the server's log, in English: the
 * status is what the form speaks from, as `imageRefusedSaid` does for an image.
 */
export function eventRefusedSaid(error: unknown): string {
  if (!(error instanceof ApiError)) return describe(error)
  if (error.problem.status === 400) return "L'événement n'a pas été accepté :"
  if (error.problem.status === 404) return "Ce rejeu n'existe plus."
  return "L'événement n'a pas pu être enregistré."
}

/**
 * The fields the API refused, one line each, in French.
 *
 * A field or a message this list does not know is said in general terms
 * rather than in the API's English: the line still tells the agent that
 * something they sent was refused, and the server's log says what.
 */
export function refusalsSaid(refusals: ApiProblem['refusals']): string[] {
  return (refusals ?? []).map(
    (one) => `${FIELDS[one.path] ?? 'Un champ'} : ${MESSAGES[one.message] ?? 'valeur refusée'}`,
  )
}
