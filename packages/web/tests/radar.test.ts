import { describe, expect, it } from 'vitest'

import type { DatasetStatus } from '@smmarchives/shared/contracts/replay.ts'

import {
  extentOf,
  labelOf,
  openingProductOf,
  productsOf,
  sheetAt,
  sheetsOf,
  toleranceOf,
} from '../src/radar.ts'
import { aFrame, aSeries, at, FRANCE } from './support/content.ts'

const framesAt = (...isos: string[]) => isos.map((iso) => aFrame(iso))

const hourly = aSeries({ delivery: '20034', product: 'pluvio1h', frames: framesAt() })

/** A delivery of one product that actually left an image, which is what counts. */
const delivered = (product: string, delivery = '20034') =>
  aSeries({ delivery, product, frames: framesAt('2019-10-22T12:00:00Z') })

describe('the products a replay holds', () => {
  /**
   * Read off the deliveries and never off a list in the code: the live route
   * serves eight products where a delivery carries nine, and the documentation requires
   * the available ones to be deduced from what was delivered.
   */
  it('names each product once, whichever delivery brought it', () => {
    const series = [delivered('pluvio1h'), delivered('pluvio1h', '20036'), delivered('pluvio5mn')]

    expect(productsOf(series)).toEqual(['pluvio5mn', 'pluvio1h'])
  })

  /** Shortest first, which is how a reader goes from the shower to the episode. */
  it('orders them by the span they cover', () => {
    const series = ['pluvio24h', 'pluvio5mn', 'pluvio2h', 'pluvio72h'].map((product) =>
      delivered(product),
    )

    expect(productsOf(series)).toEqual(['pluvio5mn', 'pluvio2h', 'pluvio24h', 'pluvio72h'])
  })

  /**
   * A product the replay holds no image of over its period is not a product a
   * reader can choose. Offered, it empties the map and the lane the moment it
   * is picked, while the sentence under the map goes on saying the rainfall is
   * drawn. The long cumuls produce one image an hour, so a short period reaches
   * this on its own.
   */
  it('leaves out a product it holds no image of over the period', () => {
    const series = [
      aSeries({ product: 'pluvio5mn', frames: framesAt('2019-10-22T12:00:00Z') }),
      aSeries({ product: 'pluvio24h' }),
    ]

    expect(productsOf(series)).toEqual(['pluvio5mn'])
    expect(openingProductOf(series)).toBe('pluvio5mn')
  })

  /**
   * A product whose name is not one of the two shapes seen so far is kept and
   * shown last. Dropped, a delivery naming its products some other way would
   * leave the reader a menu that silently omits images the replay holds.
   */
  it('keeps a product whose span it cannot read, after the ones it can', () => {
    const series = [delivered('cumul-inconnu'), delivered('pluvio6h')]

    expect(productsOf(series)).toEqual(['pluvio6h', 'cumul-inconnu'])
  })
})

describe('naming a product for a reader', () => {
  it('reads the span out of the identifier', () => {
    expect(labelOf('pluvio5mn')).toBe('Cumul 5 min')
    expect(labelOf('pluvio1h')).toBe('Cumul 1 h')
    expect(labelOf('pluvio72h')).toBe('Cumul 72 h')
  })

  /** Remote identifiers are quoted, never invented: `AGENTS.md` says so. */
  it('gives back an identifier it cannot read, as it is', () => {
    expect(labelOf('cumul-inconnu')).toBe('cumul-inconnu')
  })
})

describe('the images of one product', () => {
  /**
   * The index holds the address the image came from inside the delivery; the
   * replay froze it one level down, under `radar/`. `docs/utilisation.md` records the
   * asymmetry with a webcam, whose stored path carries its own prefix.
   */
  it('addresses an image where the replay froze it, not where it came from', () => {
    const series = [aSeries({ product: 'pluvio1h', frames: framesAt('2019-10-22T12:00:00.000Z') })]

    expect(sheetsOf(series, 'pluvio1h')[0]?.path).toBe('radar/20034/pluvio1h/1571745600.png')
  })

  it('merges the deliveries of one product, oldest first', () => {
    const series = [
      aSeries({ delivery: '20036', product: 'pluvio1h', frames: framesAt('2019-10-22T13:00:00Z') }),
      aSeries({ delivery: '20034', product: 'pluvio1h', frames: framesAt('2019-10-22T12:00:00Z') }),
      aSeries({
        delivery: '20034',
        product: 'pluvio5mn',
        frames: framesAt('2019-10-22T12:30:00Z'),
      }),
    ]

    expect(sheetsOf(series, 'pluvio1h').map((one) => one.at)).toEqual([
      at('2019-10-22T12:00:00Z'),
      at('2019-10-22T13:00:00Z'),
    ])
  })

  it('holds nothing of a product the replay never indexed', () => {
    expect(sheetsOf([hourly], 'pluvio24h')).toEqual([])
  })
})

describe('the image shown at an instant', () => {
  /**
   * A hole of forty minutes in a delivery whose images fall every five. The
   * middle of that hole is what the tolerance exists for.
   */
  const punched = sheetsOf(
    [
      aSeries({
        product: 'pluvio5mn',
        frames: framesAt(
          '2019-10-22T12:00:00Z',
          '2019-10-22T12:05:00Z',
          '2019-10-22T12:10:00Z',
          '2019-10-22T12:50:00Z',
          '2019-10-22T12:55:00Z',
          '2019-10-22T13:00:00Z',
        ),
      }),
    ],
    'pluvio5mn',
  )
  const tolerance = toleranceOf(punched)

  it('is the nearest one, produced before the instant or after it', () => {
    expect(sheetAt(punched, at('2019-10-22T12:06:00Z'), tolerance)?.at).toBe(
      at('2019-10-22T12:05:00Z'),
    )
    expect(sheetAt(punched, at('2019-10-22T12:47:00Z'), tolerance)?.at).toBe(
      at('2019-10-22T12:50:00Z'),
    )
  })

  /**
   * Nothing rather than the last one before: a cumulative rainfall image read
   * twenty minutes after its own production, on a delivery that produces one
   * every five, is a figure the reader would take for the one they are looking
   * at. The hole in the delivery is what the blank says.
   */
  it('is nothing when the nearest was produced further off than a step', () => {
    expect(sheetAt(punched, at('2019-10-22T12:30:00Z'), tolerance)).toBeUndefined()
  })

  /**
   * The rule the whole function rests on, held at the millisecond: one step in
   * and the image is drawn, one millisecond further and it is not. Left untested
   * at its own boundary, turning the bound strict or halving the step would pass.
   */
  it('is drawn at one step away, and gone one millisecond further', () => {
    const noon = at('2019-10-22T12:10:00Z')

    expect(sheetAt(punched, noon + 5 * 60_000, tolerance)?.at).toBe(noon)
    expect(sheetAt(punched, noon + 5 * 60_000 + 1, tolerance)).toBeUndefined()
  })

  /**
   * The other cadence the documentation records: five minutes up to the six-hour cumul,
   * sixty above. Neither is written down anywhere — both come out of the images
   * — so the hourly one has to be exercised or only half the rule is held.
   */
  it('takes the step of the delivery itself, at either cadence', () => {
    const hourly = sheetsOf(
      [
        aSeries({
          product: 'pluvio24h',
          frames: framesAt('2019-10-22T12:00:00Z', '2019-10-22T13:00:00Z', '2019-10-22T14:00:00Z'),
        }),
      ],
      'pluvio24h',
    )

    expect(tolerance).toBe(5 * 60_000)
    expect(toleranceOf(hourly)).toBe(60 * 60_000)
    expect(sheetAt(hourly, at('2019-10-22T12:55:00Z'), toleranceOf(hourly))?.at).toBe(
      at('2019-10-22T13:00:00Z'),
    )
  })

  /**
   * Two deliveries can carry the same instant of the same product, and a median
   * step of zero is not a step: taken literally it would draw the image on that
   * millisecond alone, which is the very thing the single-image case avoids.
   */
  it('claims no step when the images it has share their instants', () => {
    const twice = sheetsOf(
      [
        aSeries({ delivery: '20034', frames: framesAt('2019-10-22T12:00:00Z') }),
        aSeries({ delivery: '20036', frames: framesAt('2019-10-22T12:00:00Z') }),
      ],
      'pluvio24h',
    )

    expect(toleranceOf(twice)).toBeUndefined()
  })

  /**
   * One image is a delivery with nothing to say about holes, and refusing to
   * draw it would hide the only thing the replay holds of that product.
   */
  it('is shown throughout when the delivery left a single image', () => {
    const one = sheetsOf([aSeries({ frames: framesAt('2019-10-22T12:00:00Z') })], 'pluvio24h')

    expect(toleranceOf(one)).toBeUndefined()
    expect(sheetAt(one, at('2019-10-22T23:00:00Z'), undefined)?.at).toBe(at('2019-10-22T12:00:00Z'))
  })

  it('is nothing at all when the replay holds no image of the product', () => {
    expect(sheetAt([], at('2019-10-22T12:00:00Z'), undefined)).toBeUndefined()
  })
})

describe('the extent the images are placed on', () => {
  const reported = (extra: Record<string, unknown>): DatasetStatus => ({
    count: 9,
    report: {
      script: 'index:radar-rainfall',
      ranAt: '2026-09-12T18:41:15.987Z',
      request: {},
      sourcesWithoutData: [],
      fallbacks: [],
      failures: [],
      ...extra,
    },
  })

  /**
   * `AGENTS.md` files the extent under « Unsettled — do not hardcode »: a
   * parameter, reported with the data. Read off the shared default instead, a
   * replay collected with another one would be drawn on an extent it was never
   * indexed against, and nothing on screen would say so.
   */
  it('is the one the collection reported', () => {
    expect(extentOf(reported({ extent: FRANCE }))).toEqual(FRANCE)
  })

  it('is nothing when the lane never ran', () => {
    expect(extentOf(undefined)).toBeUndefined()
  })

  it('is nothing when the report carries none', () => {
    expect(extentOf(reported({}))).toBeUndefined()
  })

  /**
   * Nothing rather than a guess. A wrong extent shifts the whole layer, and the
   * shift is invisible on an image of rain — so an extent that does not read as
   * one leaves the layer undrawn and the map says why.
   */
  it('is nothing when what it carries does not read as an extent', () => {
    expect(extentOf(reported({ extent: '−9.97,39.46,14.55,54.18' }))).toBeUndefined()
    expect(extentOf(reported({ extent: { ...FRANCE, minLon: 20 } }))).toBeUndefined()
  })
})

describe('the product a reader opens on', () => {
  /**
   * The hourly cumul: short enough to follow a squall across the basin, long
   * enough to carry something on an image. The five-minute one is the palest of
   * the nine and reads as an empty map on a quiet hour.
   */
  it('is the hourly cumul when the replay holds it', () => {
    const series = ['pluvio5mn', 'pluvio1h', 'pluvio24h'].map((product) => delivered(product))

    expect(openingProductOf(series)).toBe('pluvio1h')
  })

  it('is the shortest span it holds when it does not', () => {
    const series = ['pluvio24h', 'pluvio6h'].map((product) => delivered(product))

    expect(openingProductOf(series)).toBe('pluvio6h')
  })

  it('is nothing at all when the replay holds no series', () => {
    expect(openingProductOf([])).toBeUndefined()
  })
})
