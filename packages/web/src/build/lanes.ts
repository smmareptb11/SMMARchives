/** What each strand of a build is called on screen. */
export const LANE_LABEL: Record<string, string> = {
  aquasys: 'Aquasys',
  lizmap: 'Lizmap',
  'radar-rainfall': 'Lames d’eau',
  events: 'Franchissements',
  media: 'Images radar',
}

/**
 * What a replay lacks when a strand did not run, said in the reader's terms:
 * a host's name alone does not tell an agent that the webcams are gone.
 */
const MISSING: Record<string, string> = {
  aquasys: 'les stations, les pluviomètres, leurs mesures et leurs seuils manquent',
  // The structures shown come from Aquasys: Lizmap places the webcams.
  lizmap: 'les webcams et leurs images manquent',
  'radar-rainfall': 'la pluie radar manque',
  events: 'les franchissements de seuils manquent',
  // The webcams' images are Lizmap's: this strand copies the radar's.
  media: 'les images de la pluie radar manquent',
}

/** The sentence for a strand that did not run, its technical reason left aside. */
export function missingSaid(lane: string, state: string): string {
  const label = LANE_LABEL[lane] ?? lane
  const what = MISSING[lane] ?? 'des données manquent'
  const how = state === 'failed' ? 'en échec' : 'interrompue'
  return `Étape « ${label} » ${how} : ${what} à ce rejeu.`
}
