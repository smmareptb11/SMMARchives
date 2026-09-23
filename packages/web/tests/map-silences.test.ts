import { describe, expect, it } from 'vitest'

import type { RainGauge } from '@smmarchives/shared/contracts/station.ts'

import { silencesOf } from '../src/map/silences.ts'
import { aGauge, aSeries, aStation, held } from './support/content.ts'

const NO_RADAR = "Ce rejeu ne porte aucune lame d'eau radar."
const WHAT_THE_BLUE_COUNTS =
  "Le bleu d'un pluviomètre compte la pluie horodatée dans la période : une mesure journalière y apporte des heures tombées avant le rejeu."
const NO_COLOUR = "Les pluviomètres n'ont pas de couleur : ce rejeu ne porte aucune mesure."

/** A replay that knows the parc's rain, which is what gives a gauge a blue. */
const measured = (rainGauges: RainGauge[]) => held({ rainGauges, rain: new Map() })
const STAYS_BLUE =
  "Une station sans échelle de seuils reste bleue : ce n'est pas la même chose que rien à signaler."

describe('what the map says it is not showing', () => {
  it('says of an empty replay only that it holds no radar rainfall', () => {
    expect(silencesOf(held())).toEqual([NO_RADAR])
  })

  it("says where a rain gauge's blue starts counting, when the replay holds any", () => {
    expect(silencesOf(measured([aGauge(1, 'Pezens', 2.2)]))).toEqual([
      WHAT_THE_BLUE_COUNTS,
      NO_RADAR,
    ])
  })

  it('says a station with no ladder stays blue, which is not the same as nothing happened', () => {
    expect(silencesOf(held({ stations: [aStation(1, 'Trèbes')] }))).toEqual([STAYS_BLUE, NO_RADAR])
  })

  /** A sentence about a family the replay does not hold is noise. */
  it('says nothing of a family the replay is empty of', () => {
    expect(silencesOf(measured([aGauge(1, 'Pezens', 2.2)]))).not.toContain(STAYS_BLUE)
    expect(silencesOf(held({ stations: [aStation(1, 'Trèbes')] }))).not.toContain(
      WHAT_THE_BLUE_COUNTS,
    )
  })

  it('says one source was not drawn when exactly one had no position', () => {
    const content = held({
      stations: [aStation(1, 'Trèbes'), aStation(2, 'Nulle part', 'watercourse', null)],
    })

    expect(silencesOf(content)).toContain("1 source sans position n'est pas dessinée.")
  })

  it('counts them across the families, since the map draws them all', () => {
    const content = held({
      stations: [aStation(1, 'Nulle part', 'watercourse', null)],
      rainGauges: [aGauge(2, 'Pezens', 2.2, null)],
    })

    expect(silencesOf(content)).toContain('2 sources sans position ne sont pas dessinées.')
  })

  it('says nothing of positions when it placed them all', () => {
    expect(silencesOf(held({ stations: [aStation(1, 'Trèbes')] })).join(' ')).not.toContain(
      'sans position',
    )
  })

  /**
   * The sentence is about the family the replay holds, not about what was
   * painted: the legend lists the family either way.
   */
  it("still says where a gauge's blue starts when none could be placed", () => {
    const nowhere = aGauge(1, 'Pezens', 2.2, null)

    expect(silencesOf(measured([nowhere]))).toEqual([
      WHAT_THE_BLUE_COUNTS,
      "1 source sans position n'est pas dessinée.",
      NO_RADAR,
    ])
  })

  /**
   * A build whose Aquasys lane failed still serves its stations and its map:
   * the gauges keep the neutral, and « aucune mesure » would be read as a fact
   * about each of them rather than about the replay.
   */
  it('says a gauge has no colour when the replay knows no rain at all', () => {
    expect(silencesOf(held({ rainGauges: [aGauge(1, 'Pezens', 2.2)] }))).toEqual([
      NO_COLOUR,
      NO_RADAR,
    ])
  })

  /** The extent of a delivery is not confirmed, and a wrong one shifts it all. */
  it('says the radar rainfall a replay holds an image of is not drawn', () => {
    const series = aSeries({ frames: [{ at: '2019-10-22T06:00:00.000Z', path: 'radar/a.tif' }] })

    expect(silencesOf(held({ series: [series] }))).toEqual([
      "Les lames d'eau radar ne sont pas dessinées : leur emprise n'est pas confirmée.",
    ])
  })

  /** A delivery indexed with no frame in the period leaves nothing to draw. */
  it('says a replay holding no image of a radar series holds none', () => {
    expect(silencesOf(held({ series: [aSeries()] }))).toEqual([NO_RADAR])
  })
})
