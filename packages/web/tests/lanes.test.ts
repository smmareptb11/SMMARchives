import { describe, expect, it } from 'vitest'

import {
  assumedCrossings,
  heldIn,
  lanesOf,
  placeOf,
  spacedOut,
  tiled,
} from '../src/tracks/lanes.ts'
import type { FrozenWebcamImage } from '@smmarchives/shared/contracts/webcam.ts'

import { aCamera, aCrossing, aStation, aView, held, period, shown } from './support/content.ts'

describe('placing a segment on the ruler', () => {
  it('is a fraction of the period, never a pixel', () => {
    expect(placeOf(period, '2019-10-22T06:00:00.000Z', '2019-10-22T12:00:00.000Z')).toEqual({
      left: 25,
      width: 25,
    })
  })

  /**
   * A crossing with no end is a point in time — the contract says so, and the
   * map reads it the same way. A caller that means « to the end of the period »
   * names that end, so one `null` never means two things.
   */
  it('gives a crossing with no end the instant it happened, and nothing more', () => {
    const from = '2019-10-22T18:00:00.000Z'

    expect(placeOf(period, from, from)).toEqual({ left: 75, width: 0.4 })
    expect(placeOf(period, from, period.to)).toEqual({ left: 75, width: 25 })
  })

  it('keeps what began before the period visible from its first instant', () => {
    expect(placeOf(period, '2019-10-21T00:00:00.000Z', '2019-10-22T06:00:00.000Z')).toEqual({
      left: 0,
      width: 25,
    })
  })

  /**
   * A width, and one a finger can land on. Any value above zero passes for a
   * width and none of them is clickable, so the figure is pinned rather than
   * bounded: four tenths of a percent is four pixels on a lane a thousand wide.
   */
  it('gives a point in time a width one can still click', () => {
    expect(placeOf(period, '2019-10-22T06:00:00.000Z', '2019-10-22T06:00:00.000Z').width).toBe(0.4)
  })
})

describe('the lanes of a replay', () => {
  const aParc = () =>
    held({
      stations: [aStation(84, 'Trèbes'), aStation(91, 'Narbonne')],
      events: [aCrossing({ sourceId: 84, from: '2019-10-22T06:00:00.000Z', to: null })],
    })

  it('gives a station a lane whether it crossed a threshold or not', () => {
    const watercourses = shown(lanesOf(aParc()), 'watercourse')

    expect(watercourses?.lanes.map((one) => one.label)).toEqual(['Trèbes', 'Narbonne'])
    // An empty lane says something: the station was there, and nothing crossed.
    expect(watercourses?.lanes[1]?.marks).toEqual([])
    expect(watercourses?.lanes[0]?.marks).toHaveLength(1)
  })

  /**
   * A parc of ninety stations puts three of them in alert, and the quiet ones
   * bury those three. Held back rather than dropped: the count is what keeps
   * the eighty-seven from reading as a replay of three sources.
   */
  it('holds back a lane with nothing on it, and says how many', () => {
    const watercourses = shown(lanesOf(aParc()), 'watercourse', false)

    expect(watercourses?.lanes.map((one) => one.label)).toEqual(['Trèbes'])
    expect(watercourses?.held).toBe(1)
  })

  it('keeps a family whose every lane it held back, or the replay reads as holding none', () => {
    const family = shown(
      lanesOf(held({ stations: [aStation(91, 'Narbonne')] })),
      'watercourse',
      false,
    )

    expect(family?.lanes).toEqual([])
    expect(family?.held).toBe(1)
  })

  it('says nothing of holding back when it held nothing back', () => {
    expect(shown(lanesOf(aParc()), 'watercourse')?.held).toBe(0)
  })

  it('counts what it holds back over every family at once', () => {
    expect(heldIn(lanesOf(aParc()))).toBe(1)
  })

  it('keeps the families apart, as the map will', () => {
    const families = lanesOf(
      held({ stations: [aStation(84, 'Trèbes'), aStation(3, 'Digue de Cuxac', 'structure')] }),
    )

    expect(families.map((one) => one.id)).toEqual(['watercourse', 'structure'])
  })

  it('leaves out a family the replay holds nothing of', () => {
    expect(lanesOf(held())).toEqual([])
  })

  it('holds back the webcams whose images the replay kept none of, and counts them', () => {
    // Ceneau keeps an image for a month: a replay of 2019 holds the cameras
    // and not one picture. Said nothing of, the screen would read as a replay
    // with no webcam at all.
    const webcams = [aCamera('215', 'Mailhac')]
    const content = held({ webcams, images: [] })

    // Held back and not collapsed into a silent family: collapsed, the switch
    // would show no count and nothing could bring the cameras back.
    expect(shown(lanesOf(content), 'webcam', false)?.lanes).toEqual([])
    expect(shown(lanesOf(content), 'webcam', false)?.held).toBe(1)
    expect(shown(lanesOf(content), 'webcam')?.lanes).toHaveLength(1)
  })

  /**
   * Held back rather than absent: three hundred empty lanes would bury the ones
   * that have something to say, and the reader is the one who asks for them.
   */
  it('gives a camera the replay froze no picture of a lane only when asked', () => {
    const webcams = [aCamera('215', 'Mailhac'), aCamera('308', 'Trèbes')]
    const images = [aView({ code: '215', at: '2019-10-22T06:00:00.000Z' })]
    const labelsOf = (mutesShown: boolean) =>
      shown(lanesOf(held({ webcams, images })), 'webcam', mutesShown)?.lanes.map((one) => one.label)

    expect(labelsOf(false)).toEqual(['Mailhac'])
    expect(labelsOf(true)).toEqual(['Mailhac', 'Trèbes'])
  })

  it('gives the camera it was asked for a lane with no frame on it', () => {
    const family = lanesOf(
      held({
        webcams: [aCamera('215', 'Mailhac'), aCamera('308', 'Trèbes')],
        images: [aView({ code: '215', at: '2019-10-22T06:00:00.000Z' })],
      }),
    ).find((one) => one.id === 'webcam')

    expect(family?.lanes.find((one) => one.label === 'Trèbes')?.marks).toEqual([])
  })

  /**
   * The same count as a station's, from the same rule: a camera held back and a
   * station held back are one absence, and two ways of counting them would let
   * the switch say a number neither of the two families recognises.
   */
  it('counts a camera it held back beside the stations it held back', () => {
    const content = held({
      stations: [aStation(91, 'Narbonne')],
      webcams: [aCamera('215', 'Mailhac'), aCamera('308', 'Trèbes')],
      images: [aView({ code: '215', at: '2019-10-22T06:00:00.000Z' })],
    })

    expect(shown(lanesOf(content), 'webcam', false)?.held).toBe(1)
    expect(heldIn(lanesOf(content))).toBe(2)
  })

  /**
   * A replay whose Aquasys lane failed knows nothing of its parc. A lane each
   * with not one bar on it would accuse two hundred and twenty-nine gauges of
   * having measured nothing, which is not what an absent data set says.
   */
  it('counts the rain gauges it holds no lane for, rather than hiding them', () => {
    const gauges = [aStation(4, 'Couiza'), aStation(9, 'Villegly')]
    const families = lanesOf(held({ rainGauges: gauges, rain: undefined }))

    expect(families.find((one) => one.id === 'rain-gauge')?.silent).toBe(2)
  })
})

describe('a crossing whose threshold was classified by guesswork', () => {
  const crossing = {
    thresholdId: 4,
    label: 'Débit de crise',
    quantity: 'flow' as const,
    value: 2.1,
    measured: 3.07,
    peak: 19,
    ladderHeight: 4,
    stillActiveAtEnd: true,
  }

  function anEvent(natureIsFallback: boolean) {
    return {
      id: 'c1',
      origin: 'automatic' as const,
      category: 'threshold-crossing' as const,
      title: 'Débit de crise',
      description: null,
      provenance: null,
      severity: 1,
      color: '#ff0000',
      from: '2019-10-22T06:00:00.000Z',
      to: null,
      position: null,
      sourceId: 84,
      media: [],
      crossing: { ...crossing, natureIsFallback },
    }
  }

  /**
   * A ladder with neither `category` nor `isOverrunThreshold` has its nature
   * assumed from the label, and a drought ladder read as an alert one fires on
   * an ordinary flow. The replay says it assumed; the screen must too, or a
   * guess reads as a fact.
   */
  it('is marked as assumed, and counted', () => {
    const families = lanesOf(held({ stations: [aStation(84, 'Trèbes')], events: [anEvent(true)] }))

    expect(families[0]?.lanes[0]?.marks[0]?.assumed).toBe(true)
    expect(assumedCrossings(held({ stations: [], events: [anEvent(true), anEvent(false)] }))).toBe(
      1,
    )
  })

  it('is not marked when the replay read the nature rather than assuming it', () => {
    const families = lanesOf(held({ stations: [aStation(84, 'Trèbes')], events: [anEvent(false)] }))

    expect(families[0]?.lanes[0]?.marks[0]?.assumed).toBeUndefined()
  })
})

describe('what a lane can actually show', () => {
  const hundred = Array.from({ length: 100 }, (_, index) => ({ left: index }))

  // A replay of 24 hours holds 1 537 images: shown whole, each would be a
  // pixel, and the browser would fetch 1 537 files to draw a smear.
  it('never draws two marks closer together than the gap', () => {
    const kept = spacedOut(hundred, 6).map((one) => one.left)
    const between = kept.slice(1).map((left, index) => left - (kept[index] ?? 0))

    expect(Math.min(...between)).toBeGreaterThanOrEqual(6)
  })

  /**
   * The last mark is what says where a lane ends, and the spacing leaves it out
   * whenever the period does not divide by the gap. Kept, it also takes the
   * place of the one before it when the two would touch: two marks against each
   * other say less than one at the end.
   */
  it('ends on the last mark, and not on the one before it', () => {
    const kept = spacedOut(hundred, 6).map((one) => one.left)

    expect(kept.at(-1)).toBe(99)
    expect(kept).not.toContain(96)
  })

  it('keeps the first and the last, whatever the gap', () => {
    const marks = [{ left: 0 }, { left: 1 }, { left: 99 }]

    expect(spacedOut(marks, 50)).toEqual([{ left: 0 }, { left: 99 }])
  })
})

describe('a webcam lane', () => {
  const webcams = [aCamera('215', 'Mailhac')]

  function framesOf(images: FrozenWebcamImage[]) {
    const family = shown(lanesOf(held({ webcams, images })), 'webcam', false)
    return family?.lanes[0]
  }

  it('runs a picture up to the next one, so the lane is a strip and not a row of pins', () => {
    const lane = framesOf([
      aView({ at: '2019-10-22T00:00:00.000Z', storedPath: 'webcams/215/a.jpg' }),
      aView({ at: '2019-10-22T06:00:00.000Z', storedPath: 'webcams/215/b.jpg' }),
    ])

    expect(lane?.filmstrip).toBe(true)
    expect(lane?.marks.map((one) => one.width)).toEqual([25, 75])
  })

  it('runs the last picture to the end of the period, as Ceneau says nothing more', () => {
    const lane = framesOf([
      aView({ at: '2019-10-22T18:00:00.000Z', storedPath: 'webcams/215/a.jpg' }),
    ])

    expect(lane?.marks).toEqual([
      {
        left: 75,
        width: 25,
        at: '2019-10-22T18:00:00.000Z',
        path: 'webcams/215/a.jpg',
        full: 'webcams/215/a.jpg',
      },
    ])
  })

  /**
   * Six hundred kilobytes a frame to paint eighty pixels of lane, against four
   * for the reduction Ceneau publishes beside it. The full image is still what
   * a reader gets on demand, so the strip is cheap and the view is not lost.
   */
  it('draws the reduction and keeps the full image behind it', () => {
    const lane = framesOf([
      aView({
        at: '2019-10-22T00:00:00.000Z',
        storedPath: 'webcams/215/a.jpg',
        storedThumbPath: 'webcams/215/thumbs/a.jpg',
      }),
    ])

    expect(lane?.marks[0]?.path).toBe('webcams/215/thumbs/a.jpg')
    expect(lane?.marks[0]?.full).toBe('webcams/215/a.jpg')
  })

  it('draws the full image when the replay was built before reductions were frozen', () => {
    const lane = framesOf([
      aView({ at: '2019-10-22T00:00:00.000Z', storedPath: 'webcams/215/a.jpg' }),
    ])

    expect(lane?.marks[0]?.path).toBe('webcams/215/a.jpg')
  })

  it('orders the frames by their instant, whatever order the data set came in', () => {
    const lane = framesOf([
      aView({ at: '2019-10-22T12:00:00.000Z', storedPath: 'webcams/215/b.jpg' }),
      aView({ at: '2019-10-22T00:00:00.000Z', storedPath: 'webcams/215/a.jpg' }),
    ])

    expect(lane?.marks.map((one) => one.left)).toEqual([0, 50])
  })

  /** Nothing to open behind a frame whose full image the build never got. */
  it('keeps a view the build reduced but never copied whole', () => {
    const lane = framesOf([
      aView({
        at: '2019-10-22T00:00:00.000Z',
        storedPath: null,
        storedThumbPath: 'webcams/215/thumbs/a.jpg',
      }),
    ])

    expect(lane?.marks[0]?.path).toBe('webcams/215/thumbs/a.jpg')
    expect(lane?.marks[0]?.full).toBeUndefined()
  })

  it('leaves out a picture the replay could not copy, and tiles over its place', () => {
    // Neither copy came back: the lane would otherwise open a frame on a file
    // the replay does not hold.
    const lane = framesOf([
      aView({ at: '2019-10-22T00:00:00.000Z', storedPath: 'webcams/215/a.jpg' }),
      aView({ at: '2019-10-22T06:00:00.000Z', storedPath: null }),
      aView({ at: '2019-10-22T12:00:00.000Z', storedPath: 'webcams/215/c.jpg' }),
    ])

    expect(lane?.marks.map((one) => one.width)).toEqual([50, 50])
  })
})

describe('the frames a strip still shows once thinned', () => {
  /**
   * Dropped frames leave the survivors ending where nothing is drawn any more.
   * Without the stretch, a strip thinned from a quarter-hour cadence would show
   * one sliver every sixty pixels with the lane's ground between them — which
   * is the very thing the strip replaced.
   */
  it('stretches what is kept up to the next one, leaving no hole in the strip', () => {
    const marks = Array.from({ length: 5 }, (_, index) => ({
      left: index * 10,
      width: 10,
      at: `2019-10-22T0${String(index)}:00:00.000Z`,
    }))

    expect(tiled(marks, 20)).toEqual([
      { left: 0, width: 20, at: '2019-10-22T00:00:00.000Z' },
      { left: 20, width: 20, at: '2019-10-22T02:00:00.000Z' },
      { left: 40, width: 10, at: '2019-10-22T04:00:00.000Z' },
    ])
  })
})
