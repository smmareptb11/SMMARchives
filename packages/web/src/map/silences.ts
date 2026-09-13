import type { ReplayContent } from '../tracks/lanes.ts'
import { radarStandingOf, type RadarStanding } from '../radar.ts'
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
 * rainfall is the exception, and says something in every state: a replay
 * holding none is itself worth saying, since the layer is expected.
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

  said.push(...RADAR_SAID[radarStandingOf(content)])

  return said
}

/**
 * What the map holds back of the rainfall, in the three states it can be in.
 *
 * On the images and not on the series: a delivery indexed with no frame in the
 * period leaves the replay with nothing to draw, whatever its extent.
 *
 * Said « une fois affichées » rather than in the present: the layer opens off,
 * and a sentence describing a drawing that is not happening would turn false
 * the day the extent is confirmed and someone lights it by default.
 *
 * Held and placeable, the map says two things rather than none. The extent is
 * the one value the documentation flags as unconfirmed — read from a script whose own
 * author annotated it « à vérifier visuellement » — and a shift of a few
 * kilometres is invisible on an image of rain, which is why the layer opens off
 * and why the sentence says so rather than describing a drawing that is not
 * happening. And the image stays an image: a legend does exist, but the palette
 * behind it is a continuous gradient quantised to 256 near-duplicates, so
 * reading a colour back gives a noisy estimate and never a measure.
 */
const RADAR_SAID: Record<RadarStanding, string[]> = {
  none: ["Ce rejeu ne porte aucune lame d'eau radar."],
  unplaced: [
    "Les lames d'eau radar ne sont pas dessinées : l'emprise sur laquelle les poser n'a pas été enregistrée.",
  ],
  drawable: [
    "Les lames d'eau radar, une fois affichées, peuvent être décalées : leur emprise n'est pas confirmée, et un décalage de plusieurs kilomètres ne se voit pas sur une image de pluie.",
    "La couleur d'une lame d'eau ne se convertit pas en millimètres : sa palette est un dégradé continu, dont une couleur ne redonne pas une mesure.",
  ],
}
