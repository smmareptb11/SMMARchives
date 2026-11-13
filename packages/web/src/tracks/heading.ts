import { MUTES } from '../mutes.ts'
import type { Family } from './lanes.ts'

/** Why a whole family of cameras can hold nothing, which the reader will ask. */
const RETENTION =
  'Les images des webcams ne sont disponibles que pendant un mois : pour une période plus ancienne, aucune n’a pu être copiée.'

/** What a family's lanes are of, singular then plural. */
const SOURCES: Record<string, [string, string]> = {
  watercourse: ['station', 'stations'],
  structure: ['ouvrage', 'ouvrages'],
  'rain-gauge': ['pluviomètre', 'pluviomètres'],
  webcam: ['webcam', 'webcams'],
}

/** The families whose sources are feminine, which « aucune » agrees with. */
const FEMININE = new Set(['watercourse', 'webcam'])

const plural = (count: number) => (count > 1 ? 's' : '')

/** What a family's switch on its lanes that crossed nothing is called, which the count points back at. */
export function quietLabel(family: string): string {
  const [, several] = SOURCES[family] ?? ['source', 'sources']
  return `Afficher les ${several} sans franchissement`
}

/**
 * What a family's heading counts, and what the count leaves unsaid.
 *
 * The lanes shown out of the lanes held, when a switch holds some back: a
 * family showing three lanes out of ninety-four would otherwise read as a
 * replay of three sources. What the count does not say — why lanes are held,
 * how many crossings rest on a guessed threshold — is there for the reader
 * who asks, and out of the way of the one who does not.
 *
 * `quiet` is how many of the lanes held back crossed nothing, and the rest had
 * no data: the two are held by two switches, and each note names its own.
 */
export function countOf(
  family: Family,
  shown: number,
  quiet = 0,
): { said: string; more: string | undefined } {
  if (family.count !== undefined) {
    return { said: `${String(family.count)} événement${plural(family.count)}`, more: undefined }
  }

  const held = family.lanes.length - shown
  const notes = unsaid(family, held - quiet, shown, quiet)

  return {
    said: shownSaid(family, shown, held),
    more: notes.length === 0 ? undefined : notes.join(' '),
  }
}

/**
 * How many sources the family shows, beside a title that already names them:
 * the number alone when none is held back, out of how many when some are.
 */
function shownSaid(family: Family, shown: number, held: number): string {
  const all = String(family.lanes.length)
  if (held === 0) return all
  if (shown === 0) return `${FEMININE.has(family.id) ? 'aucune' : 'aucun'} sur ${all}`
  return `${String(shown)} sur ${all}`
}

/**
 * Whether opening the family would show nothing: no lane shown, the count
 * saying « aucune », and no note standing in for the lanes. The ones that
 * crossed nothing are not offered back on a family that shows none: a band of
 * « aucun franchissement » tells nothing its count does not.
 */
export function opensOnNothing(family: Family, shown: number): boolean {
  return shown === 0 && family.count === undefined && family.silent === undefined
}

/** Why lanes are held back, and how many crossings rest on a guessed threshold. */
function unsaid(family: Family, held: number, shown: number, quiet: number): string[] {
  const notes: string[] = []
  if (held > 0) notes.push(heldSaid(family.id, held))
  if (family.id === 'webcam' && held > 0 && shown === 0) notes.push(RETENTION)
  // On a family showing nothing, the switch is out of reach: it opens no more.
  if (quiet > 0) notes.push(quietSaid(family.id, quiet, shown > 0))

  const assumed = assumedIn(family)
  if (assumed > 0) notes.push(assumedSaid(assumed))
  return notes
}

/** How many crossings of a family rest on a threshold whose type was deduced. */
export function assumedIn(family: Family): number {
  return family.lanes.flatMap((one) => one.marks).filter((one) => one.assumed === true).length
}

/** What the stripes on a lane mean, under the heading of a family that has some. */
export const HATCHED =
  'Franchissement hachuré : la source ne précise pas si son seuil est une alerte de crue, un seuil de sécheresse ou un repère de crue ; ce type a été déduit.'

/** Held back, a lane's source has nothing over the period: no measure, no crossing, no image. */
function heldSaid(family: string, held: number): string {
  const [one, several] = SOURCES[family] ?? ['source', 'sources']
  return held === 1
    ? `1 ${one} n’a aucune donnée sur cette période. Cochez « ${MUTES} » pour l’afficher.`
    : `${String(held)} ${several} n’ont aucune donnée sur cette période. Cochez « ${MUTES} » pour les afficher.`
}

function quietSaid(family: string, quiet: number, offered: boolean): string {
  const [one, several] = SOURCES[family] ?? ['source', 'sources']
  const said =
    quiet === 1
      ? `1 ${one} n’a franchi aucun seuil sur cette période.`
      : `${String(quiet)} ${several} n’ont franchi aucun seuil sur cette période.`
  if (!offered) return said
  return `${said} Cochez « ${quietLabel(family)} » pour ${quiet === 1 ? 'l’afficher' : 'les afficher'}.`
}

function assumedSaid(count: number): string {
  return count === 1
    ? '1 franchissement porte sur un seuil dont la source ne précise pas le type : le type a été déduit. Il est hachuré.'
    : `${String(count)} franchissements portent sur un seuil dont la source ne précise pas le type : le type a été déduit. Ils sont hachurés.`
}
