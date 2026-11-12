import { describe, expect, it } from 'vitest'

import type { FrozenWebcamImage } from '@smmarchives/shared/contracts/webcam.ts'

import { takenWhen, viewAt, viewStepsOf, viewsOf } from '../src/pictures.ts'
import { aView, at } from './support/content.ts'

const midnight = 'webcams/215/2019-10-22T00:00:00.000Z.jpg'
const noon = 'webcams/215/2019-10-22T12:00:00.000Z.jpg'

describe('the picture a camera shows at an instant', () => {
  const views = viewsOf([
    aView({ at: '2019-10-22T00:00:00.000Z' }),
    aView({ at: '2019-10-22T12:00:00.000Z' }),
  ])

  it('is the last one taken before the cursor', () => {
    expect(viewAt(views, '215', at('2019-10-22T08:00:00.000Z'))?.path).toBe(midnight)
    expect(viewAt(views, '215', at('2019-10-22T18:00:00.000Z'))?.path).toBe(noon)
  })

  /** The instant the strip opens the frame is the instant the map turns to it. */
  it('is the view taken on the very instant the cursor sits on', () => {
    expect(viewAt(views, '215', at('2019-10-22T12:00:00.000Z'))?.path).toBe(noon)
  })

  it('is nothing before the camera looked for the first time', () => {
    expect(viewAt(views, '215', at('2019-10-21T00:00:00.000Z'))?.path).toBeUndefined()
  })

  it('is the last view whatever order the data set came in', () => {
    const reversed = viewsOf([
      aView({ at: '2019-10-22T12:00:00.000Z' }),
      aView({ at: '2019-10-22T00:00:00.000Z' }),
    ])

    expect(viewAt(reversed, '215', at('2019-10-22T18:00:00.000Z'))?.path).toBe(noon)
  })
})

describe('the picture a camera shows when another one also looked', () => {
  // Every camera's views arrive in one data set, and the five markers read it.
  const views = viewsOf([
    aView({ at: '2019-10-22T06:00:00.000Z' }),
    aView({ code: '218', at: '2019-10-22T12:00:00.000Z' }),
  ])

  it('is never the more recent view of that other camera', () => {
    expect(viewAt(views, '215', at('2019-10-22T18:00:00.000Z'))?.path).toBe(
      'webcams/215/2019-10-22T06:00:00.000Z.jpg',
    )
  })

  it('is nothing at all for a camera the replay holds no view of', () => {
    expect(viewAt(views, '649', at('2019-10-22T18:00:00.000Z'))?.path).toBeUndefined()
  })
})

describe('the picture a camera shows, of the copies the build came back with', () => {
  const reduction = 'webcams/215/thumbs/a.jpg'
  const shown = (image: FrozenWebcamImage) =>
    viewAt(viewsOf([image]), '215', at('2019-10-22T08:00:00.000Z'))?.path

  it('is the reduction, four kilobytes against six hundred', () => {
    expect(shown(aView({ at: '2019-10-22T00:00:00.000Z', storedThumbPath: reduction }))).toBe(
      reduction,
    )
  })

  /** A replay built before the reductions were frozen holds none. */
  it('is the full image when the replay froze no reduction of it', () => {
    expect(shown(aView({ at: '2019-10-22T00:00:00.000Z' }))).toBe(midnight)
  })

  /** The two downloads are independent, so one can be had without the other. */
  it('is the reduction when the replay froze no full image of it', () => {
    expect(
      shown(
        aView({ at: '2019-10-22T00:00:00.000Z', storedPath: null, storedThumbPath: reduction }),
      ),
    ).toBe(reduction)
  })
})

describe('the picture a camera shows of a view the build never copied', () => {
  const missed = { at: '2019-10-22T12:00:00.000Z', storedPath: null, storedThumbPath: null }

  it('is the view before it, since the camera did look', () => {
    const views = viewsOf([aView({ at: '2019-10-22T00:00:00.000Z' }), aView(missed)])

    expect(viewAt(views, '215', at('2019-10-22T18:00:00.000Z'))?.path).toBe(midnight)
  })

  it('is nothing when the build copied none of that camera at all', () => {
    const views = viewsOf([
      aView({ at: '2019-10-22T00:00:00.000Z', storedPath: null }),
      aView(missed),
    ])

    expect(viewAt(views, '215', at('2019-10-22T18:00:00.000Z'))?.path).toBeUndefined()
  })
})

describe('stepping from one view of a camera to the next', () => {
  const day = { from: '2019-10-21T22:00:00.000Z', to: '2019-10-22T22:00:00.000Z' }
  const views = viewsOf([
    aView({ at: '2019-10-22T00:00:00.000Z' }),
    aView({ at: '2019-10-22T06:00:00.000Z' }),
    aView({ at: '2019-10-22T12:00:00.000Z' }),
  ])

  it('ranks the view shown and names the instants either side', () => {
    expect(viewStepsOf(views, '215', at('2019-10-22T08:00:00.000Z'), day)).toEqual({
      index: 1,
      count: 3,
      previous: at('2019-10-22T00:00:00.000Z'),
      next: at('2019-10-22T12:00:00.000Z'),
    })
  })

  it('has nothing before the first view, nor after the last', () => {
    expect(viewStepsOf(views, '215', at('2019-10-22T02:00:00.000Z'), day).previous).toBeUndefined()
    expect(viewStepsOf(views, '215', at('2019-10-22T18:00:00.000Z'), day).next).toBeUndefined()
  })

  /** Before the camera looked, there is no view shown, and the first one is ahead. */
  it('steps to the first view from before it', () => {
    expect(viewStepsOf(views, '215', at('2019-10-21T23:00:00.000Z'), day)).toEqual({
      index: undefined,
      count: 3,
      previous: undefined,
      next: at('2019-10-22T00:00:00.000Z'),
    })
  })

  it('counts nothing of a camera the replay holds no view of', () => {
    expect(viewStepsOf(views, 'nowhere', at('2019-10-22T08:00:00.000Z'), day)).toEqual({
      index: undefined,
      count: 0,
      previous: undefined,
      next: undefined,
    })
  })

  /**
   * Two views taken at once are one stop: stepping back from the second to the
   * first would land on the same instant, and show the second again.
   */
  it('steps past a view taken at the same instant as the one shown', () => {
    const twice = viewsOf([
      aView({ at: '2019-10-22T00:00:00.000Z' }),
      aView({ at: '2019-10-22T06:00:00.000Z', storedPath: 'webcams/215/a.jpg' }),
      aView({ at: '2019-10-22T06:00:00.000Z', storedPath: 'webcams/215/b.jpg' }),
    ])

    expect(viewStepsOf(twice, '215', at('2019-10-22T06:00:00.000Z'), day).previous).toBe(
      at('2019-10-22T00:00:00.000Z'),
    )
  })

  /** The reading stays in the period: a step out of it would not move the cursor. */
  it('steps only to the views within the period', () => {
    const outside = viewsOf([
      aView({ at: '2019-10-21T20:00:00.000Z' }),
      aView({ at: '2019-10-22T06:00:00.000Z' }),
      aView({ at: '2019-10-22T23:00:00.000Z' }),
    ])

    expect(viewStepsOf(outside, '215', at('2019-10-22T06:00:00.000Z'), day)).toEqual({
      index: 0,
      count: 1,
      previous: undefined,
      next: undefined,
    })
  })
})

/** A camera gone dark at noon still shows its noon view in the evening, and says so. */
describe('when the view shown was taken', () => {
  const views = viewsOf([aView({ at: '2019-10-22T10:00:00.000Z' })])
  const view = viewAt(views, '215', at('2019-10-22T19:00:00.000Z'))!

  it('says its hour, in French time, when it was taken that day', () => {
    expect(takenWhen(view, at('2019-10-22T19:00:00.000Z'))).toBe('Image prise à 12:00')
  })

  it('says its day too when it was taken on another one', () => {
    expect(takenWhen(view, at('2019-10-23T08:00:00.000Z'))).toBe('Image prise le 22/10 à 12:00')
  })
})
