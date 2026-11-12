import { describe, expect, it } from 'vitest'

import { gaugesOf } from '../src/rain.ts'
import { emptyOf, lanesOf } from '../src/tracks/lanes.ts'
import { aCamera, aCrossing, aGauge, aMeasure, aStation, held } from './support/content.ts'

describe('what an empty lane says', () => {
  const content = held({
    stations: [aStation(84, 'Trèbes'), aStation(85, 'Limoux'), aStation(86, 'Quillan')],
    events: [aCrossing({ sourceId: 84 })],
    measuredStations: new Set([84, 85]),
    rainGauges: [aGauge(4, 'Couiza', 2.2), aGauge(9, 'Villegly', 2.4)],
    rain: gaugesOf([aMeasure(4, '2019-10-22T06:00:00.000Z', 3, 'rainfall')]),
    webcams: [aCamera('215', 'Mailhac')],
  })
  const lanes = new Map(
    lanesOf(content).flatMap((family) => family.lanes.map((one) => [one.label, one])),
  )
  const said = (label: string) => {
    const lane = lanes.get(label)
    return lane === undefined ? 'no such lane' : emptyOf(lane)
  }

  it('says nothing over a lane that has marks', () => {
    expect(said('Trèbes')).toBeUndefined()
    expect(said('Couiza')).toBeUndefined()
  })

  /** The water stayed under the thresholds: a finding, not a gap. */
  it('says a station that measured crossed nothing', () => {
    expect(said('Limoux')).toEqual({ said: 'aucun franchissement sur la période', gap: false })
  })

  it('says a station or a rain gauge measured nothing, as a gap in the data', () => {
    expect(said('Quillan')).toEqual({ said: 'aucune mesure sur la période', gap: true })
    expect(said('Villegly')).toEqual({ said: 'aucune mesure sur la période', gap: true })
  })

  it('says a camera had nothing copied, as a gap in the data', () => {
    expect(said('Mailhac')).toEqual({ said: 'aucune image sur la période', gap: true })
  })
})
