import type { ReplayContent } from '../tracks/lanes.ts'

/**
 * What the map holds back, in the reader's own words, so that no absence is read
 * as a fact: a triangle that never changes colour reads as a gauge at rest. Only
 * the ones bearing on this replay.
 */
export function silencesOf(content: ReplayContent): string[] {
  const said: string[] = []

  if (content.rainGauges.length > 0 && content.rain === undefined) {
    said.push("Les pluviomètres n'ont pas de couleur : ce rejeu ne porte aucune mesure.")
  }
  // On the images and not on the series: a delivery indexed with no frame in
  // the period leaves the replay with nothing to draw, whatever its extent.
  if (content.series.some((one) => one.frames.length > 0)) {
    said.push(
      "Les lames d'eau radar ne sont pas dessinées : les images ne portent pas leur emprise.",
    )
  }

  return said
}
