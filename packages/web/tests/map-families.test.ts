import { describe, expect, it } from 'vitest'

import { familiesOf, OPENING } from '../src/map/families.ts'
import { aGauge, aLayer, aFrame, aSeries, aStation, FRANCE, held } from './support/content.ts'

const anImage = () => aSeries({ frames: [aFrame('2019-10-22T12:00:00.000Z')] })

describe('the families a replay holds', () => {
  it('are the ones it has something to draw for', () => {
    const content = held({
      stations: [aStation(1, 'Trèbes'), aStation(2, 'Puichéric', 'structure')],
      rainGauges: [aGauge(3, 'Pezens', 2.2)],
    })

    expect(familiesOf(content)).toEqual(['watercourse', 'structure', 'rain-gauge'])
  })

  /** Karst takes the circle of the watercourse stations, and claims no line. */
  it('fold karst into the watercourse stations, as the map does', () => {
    const content = held({ stations: [aStation(1, "L'Orbieu", 'karst')] })

    expect(familiesOf(content)).toEqual(['watercourse'])
  })

  it('hold no switch for a family the replay is empty of', () => {
    expect(familiesOf(held({ rainGauges: [aGauge(1, 'Pezens', 2.2)] }))).toEqual(['rain-gauge'])
    expect(familiesOf(held())).toEqual([])
  })

  it('hold the ground only when the replay copied the layer that draws it', () => {
    expect(familiesOf(held({ layers: [aLayer('perimetre_syndicats')] }))).toEqual(['territory'])
    expect(familiesOf(held({ layers: [aLayer('communes')] }))).toEqual([])
  })
})

describe('the switch on the radar rainfall', () => {
  it('is there when the replay holds an image and knows where to place it', () => {
    expect(familiesOf(held({ series: [anImage()], radarExtent: FRANCE }))).toEqual(['radar'])
  })

  /**
   * Both halves or nothing. An image with no extent cannot be placed, and an
   * extent with no image has nothing to place — a switch answering neither
   * tells a reader less than no switch at all.
   */
  it('is not there on one half of what it takes', () => {
    expect(familiesOf(held({ series: [anImage()] }))).toEqual([])
    expect(familiesOf(held({ radarExtent: FRANCE }))).toEqual([])
    expect(familiesOf(held({ series: [aSeries()], radarExtent: FRANCE }))).toEqual([])
  })

  /**
   * Off where every other family opens drawn. The extent is the one value
   * the documentation flags as unconfirmed, and a layer that may be shifted whole is not
   * put in front of a reader who did not ask for it.
   */
  it('opens off, alone among the families', () => {
    expect(OPENING.radar).toBe(false)
    expect(Object.values({ ...OPENING, radar: true }).every(Boolean)).toBe(true)
  })
})
