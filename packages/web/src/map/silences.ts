import type { ReplayContent } from '../tracks/lanes.ts'

/**
 * What the map holds back, in the reader's own words.
 *
 * An absence tells a reader nothing: a triangle that never changes colour while
 * a flood rises reads as a rain gauge at rest. Each sentence names an absence
 * the map cannot show, so that none of them is read as a fact.
 *
 * Only the ones bearing on this replay: a sentence about a family it does not
 * hold is one more line between the reader and the ones that matter.
 */
export function silencesOf(content: ReplayContent): string[] {
  const said: string[] = []

  if (content.rainGauges.length > 0 && content.rain === undefined) {
    said.push("Les pluviomètres n'ont pas de couleur : ce rejeu ne porte aucune mesure.")
  }
  // On the images and not on the series: a delivery indexed with no frame in
  // the period leaves the replay with nothing to draw, whatever its extent.
  if (content.series.some((one) => one.frames.length > 0)) {
    said.push("Les lames d'eau radar ne sont pas dessinées : leur emprise n'est pas confirmée.")
  }

  return said
}
