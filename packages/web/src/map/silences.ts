import type { ReplayContent } from '../tracks/lanes.ts'
import { placelessOf } from './sources.ts'

/**
 * What the map holds back, in the reader's own words.
 *
 * An absence tells a reader nothing: a triangle that never changes colour while
 * a flood rises reads as a rain gauge at rest, and a station that stays blue
 * reads as a station where nothing happened. Each sentence names an absence the
 * map cannot show, so that none of them is read as a fact.
 *
 * Only the ones bearing on this replay: a sentence about a family it does not
 * hold is one more line between the reader and the ones that matter. The radar
 * rainfall is the exception, and says so either way: a replay holding none is
 * itself worth saying, since the layer is expected.
 */
export function silencesOf(content: ReplayContent): string[] {
  const said: string[] = []

  if (content.rainGauges.length > 0) {
    said.push(
      content.rain === undefined
        ? "Les pluviomètres n'ont pas de couleur : ce rejeu ne porte aucune mesure."
        : "Le bleu d'un pluviomètre compte la pluie horodatée dans la période : une mesure journalière y apporte des heures tombées avant le rejeu.",
    )
  }
  if (content.stations.length > 0) {
    said.push(
      "Une station sans échelle de seuils reste bleue : ce n'est pas la même chose que rien à signaler.",
    )
  }

  const placeless = placelessOf(content)
  if (placeless > 1) said.push(`${String(placeless)} sources sans position ne sont pas dessinées.`)
  else if (placeless === 1) said.push("1 source sans position n'est pas dessinée.")

  // On the images and not on the series: a delivery indexed with no frame in
  // the period leaves the replay with nothing to draw, whatever its extent.
  said.push(
    content.series.some((one) => one.frames.length > 0)
      ? "Les lames d'eau radar ne sont pas dessinées : leur emprise n'est pas confirmée."
      : "Ce rejeu ne porte aucune lame d'eau radar.",
  )

  return said
}
