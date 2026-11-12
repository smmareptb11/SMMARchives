import { describe, expect, it } from 'vitest'

import { silencesOf } from '../src/map/silences.ts'
import { aGauge, aSeries, aStation, held } from './support/content.ts'

const NO_COLOUR = "Les pluviomètres n'ont pas de couleur : ce rejeu ne porte aucune mesure."
const RADAR_NOT_DRAWN =
  "Les lames d'eau radar ne sont pas dessinées : leur emprise n'est pas confirmée."

describe('what the map says it is not showing', () => {
  it('says nothing of a replay that holds back nothing', () => {
    expect(silencesOf(held({ stations: [aStation(1, 'Trèbes')] }))).toEqual([])
  })

  /**
   * A build whose Aquasys lane failed still serves its stations and its map:
   * the gauges keep the neutral, and « aucune mesure » would be read as a fact
   * about each of them rather than about the replay.
   */
  it('says a gauge has no colour when the replay knows no rain at all', () => {
    expect(silencesOf(held({ rainGauges: [aGauge(1, 'Pezens', 2.2)] }))).toEqual([NO_COLOUR])
  })

  /** The sentence is about the family the replay holds, not about what was painted. */
  it('says it of a gauge that could not be placed too', () => {
    expect(silencesOf(held({ rainGauges: [aGauge(1, 'Pezens', 2.2, null)] }))).toEqual([NO_COLOUR])
  })

  it('says nothing of the gauges when the replay knows their rain', () => {
    const measured = held({ rainGauges: [aGauge(1, 'Pezens', 2.2)], rain: new Map() })

    expect(silencesOf(measured)).toEqual([])
  })

  /** The extent of a delivery is not confirmed, and a wrong one shifts it all. */
  it('says the radar rainfall a replay holds an image of is not drawn', () => {
    const series = aSeries({ frames: [{ at: '2019-10-22T06:00:00.000Z', path: 'radar/a.tif' }] })

    expect(silencesOf(held({ series: [series] }))).toEqual([RADAR_NOT_DRAWN])
  })

  /** A delivery indexed with no frame in the period leaves nothing to draw. */
  it('says nothing of a radar series it holds no image of', () => {
    expect(silencesOf(held({ series: [aSeries()] }))).toEqual([])
  })
})
