import { describe, expect, it } from 'vitest'

import { countOf } from '../src/tracks/heading.ts'
import type { Family, Lane } from '../src/tracks/lanes.ts'

const lane = (id: string, marks: Lane['marks'] = []): Lane => ({ id, label: id, marks })
const familyOf = (id: string, lanes: Lane[]): Family => ({ id, label: id, lanes })

describe('what a family heading says to whoever asks', () => {
  it('names what is held back by what the family holds', () => {
    const gauges = familyOf('rain-gauge', [lane('a'), lane('b'), lane('c')])

    expect(countOf(gauges, 1).more).toBe(
      '2 pluviomètres n’ont aucune donnée sur cette période. Cochez « Sources sans données » pour les afficher.',
    )
  })

  it('speaks of one source in the singular', () => {
    const structures = familyOf('structure', [lane('a'), lane('b')])

    expect(countOf(structures, 1).more).toBe(
      '1 ouvrage n’a aucune donnée sur cette période. Cochez « Sources sans données » pour l’afficher.',
    )
  })

  /** Read without knowing where the images come from, or what a collection report is. */
  it('says why a family of cameras can hold no image at all', () => {
    const webcams = familyOf('webcam', [lane('a'), lane('b')])

    expect(countOf(webcams, 0).more).toBe(
      '2 webcams n’ont aucune donnée sur cette période. Cochez « Sources sans données » pour les afficher. ' +
        'Les images des webcams ne sont disponibles que pendant un mois : pour une période plus ancienne, aucune n’a pu être copiée.',
    )
  })

  it('counts the crossings on a threshold whose type was deduced, and says how they are drawn', () => {
    const mark = { left: 0, width: 1, at: '2019-10-22T06:00:00.000Z', assumed: true }
    const stations = familyOf('watercourse', [lane('a', [mark, mark])])

    expect(countOf(stations, 1).more).toBe(
      '2 franchissements portent sur un seuil dont la source ne précise pas le type : le type a été déduit. Ils sont hachurés.',
    )
  })
})
