import { describe, expect, it } from 'vitest'

import { familiesOf } from '../src/map/families.ts'
import { aGauge, aLayer, aStation, held } from './support/content.ts'

describe('the families a replay holds', () => {
  it('are the ones it has something to draw for', () => {
    const content = held({
      stations: [aStation(1, 'Trèbes'), aStation(2, 'Puichéric', 'structure')],
      rainGauges: [aGauge(3, 'Pezens', 2.2)],
    })

    expect(familiesOf(content)).toEqual(['watercourse', 'structure', 'rain-gauge'])
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
