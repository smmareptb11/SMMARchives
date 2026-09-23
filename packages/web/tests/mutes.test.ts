import { describe, expect, it } from 'vitest'

import { gaugesWithoutRain, webcamsWithoutPicture } from '../src/mutes.ts'
import { viewsOf } from '../src/pictures.ts'
import { gaugesOf } from '../src/rain.ts'
import { aCamera, aGauge, aMeasure, aView, held } from './support/content.ts'

const rainfall = (sourceId: number) =>
  gaugesOf([aMeasure(sourceId, '2019-10-22T06:00:00.000Z', 3, 'rainfall')])

describe('the rain gauges the replay holds nothing of', () => {
  it('names the ones that measured nothing, and only those', () => {
    const content = held({
      rainGauges: [aGauge(4, 'Couiza', 2.2), aGauge(9, 'Villegly', 2.4)],
      rain: rainfall(9),
    })

    expect([...gaugesWithoutRain(content.rainGauges, content.rain)]).toEqual([4])
  })

  /**
   * A replay whose Aquasys lane failed knows nothing of its parc, where one
   * that collected it knows a gauge measured nothing. Calling the first the
   * second would hide two hundred and twenty-nine gauges for a reason that
   * belongs to the replay and to none of them.
   */
  /**
   * The gauge looked and nothing had fallen. That is a measure, and the map
   * draws it in the palest of its blues rather than in the grey of the unread.
   */
  it('does not name a gauge whose every measure was zero', () => {
    const content = held({
      rainGauges: [aGauge(4, 'Couiza', 2.2)],
      rain: gaugesOf([aMeasure(4, '2019-10-22T06:00:00.000Z', 0, 'rainfall')]),
    })

    expect(gaugesWithoutRain(content.rainGauges, content.rain).size).toBe(0)
  })

  it('names none when the replay holds no rain at all', () => {
    const content = held({ rainGauges: [aGauge(4, 'Couiza', 2.2)], rain: undefined })

    expect(gaugesWithoutRain(content.rainGauges, content.rain).size).toBe(0)
  })
})

describe('the webcams the replay holds nothing of', () => {
  const cameras = [aCamera('215', 'Mailhac'), aCamera('308', 'Trèbes')]

  it('names the ones no picture was frozen of', () => {
    const views = viewsOf([aView({ code: '215', at: '2019-10-22T06:00:00.000Z' })])

    expect([...webcamsWithoutPicture(cameras, views)]).toEqual(['308'])
  })

  /**
   * `pictures.ts` decides what the replay holds a picture of, and it leaves out
   * a view whose two downloads both failed. Read from the paths here instead,
   * the map would draw a camera the strip has nothing to show for.
   */
  it('names a camera whose only view was never copied', () => {
    const views = viewsOf([
      aView({ code: '215', at: '2019-10-22T06:00:00.000Z' }),
      aView({ code: '308', at: '2019-10-22T06:00:00.000Z', storedPath: null }),
    ])

    expect([...webcamsWithoutPicture(cameras, views)]).toEqual(['308'])
  })

  /**
   * Their lanes are held back and counted whatever this answers, so a map still
   * drawing them would make the switch say a number it did not do.
   */
  it('names every camera when the replay holds no picture at all', () => {
    expect([...webcamsWithoutPicture(cameras, viewsOf([]))]).toEqual(['215', '308'])
  })
})
