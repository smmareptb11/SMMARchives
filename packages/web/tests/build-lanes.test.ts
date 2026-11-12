import { describe, expect, it } from 'vitest'

import { missingSaid } from '../src/build/lanes.ts'

describe('what a replay lacks when a strand did not run', () => {
  it('names what is missing rather than the host alone', () => {
    expect(missingSaid('lizmap', 'failed')).toBe(
      'Étape « Lizmap » en échec : les webcams et leurs images manquent à ce rejeu.',
    )
    expect(missingSaid('aquasys', 'failed')).toBe(
      'Étape « Aquasys » en échec : les stations, les pluviomètres, leurs mesures et leurs seuils manquent à ce rejeu.',
    )
  })

  it('says a strand that never finished was interrupted', () => {
    expect(missingSaid('radar-rainfall', 'pending')).toBe(
      'Étape « Lames d’eau » interrompue : la pluie radar manque à ce rejeu.',
    )
  })

  it('says the radar images are what the media strand copies', () => {
    expect(missingSaid('media', 'failed')).toBe(
      'Étape « Images radar » en échec : les images de la pluie radar manquent à ce rejeu.',
    )
  })

  it('keeps the name of a strand it does not know', () => {
    expect(missingSaid('ceneau', 'failed')).toBe(
      'Étape « ceneau » en échec : des données manquent à ce rejeu.',
    )
  })
})
