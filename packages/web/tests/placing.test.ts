import { describe, expect, it } from 'vitest'

import { drawingOf, extentOf, pointAt, rectangleOf } from '../src/events/placing.ts'
import { SMMAR_TERRITORY } from '@smmarchives/shared/reference/territory.ts'

const EXTENT = { minLon: 2.2, minLat: 43.1, maxLon: 2.5, maxLat: 43.3 }
const OUTSIDE = 'Ce lieu tombe hors de l’emprise du rejeu.'

describe('where an event may be placed', () => {
  it('is the replay’s extent, or the territory when it has none', () => {
    expect(extentOf({ extent: EXTENT })).toBe(EXTENT)
    expect(extentOf({ extent: null })).toBe(SMMAR_TERRITORY)
  })
})

describe('a spot', () => {
  it('is a point where the agent clicked, within the extent', () => {
    expect(pointAt([2.35, 43.21], EXTENT)).toEqual({
      position: { type: 'Point', coordinates: [2.35, 43.21] },
    })
  })

  it('is refused outside the extent', () => {
    expect(pointAt([2.6, 43.21], EXTENT)).toEqual({ refusal: OUTSIDE })
  })
})

describe('an area', () => {
  it('is the rectangle two opposite corners span, closed on its first corner', () => {
    expect(rectangleOf([2.4, 43.25], [2.3, 43.2], EXTENT)).toEqual({
      position: {
        type: 'Polygon',
        coordinates: [
          [
            [2.3, 43.2],
            [2.4, 43.2],
            [2.4, 43.25],
            [2.3, 43.25],
            [2.3, 43.2],
          ],
        ],
      },
    })
  })

  /** Two clicks on one line span no area, which the API would refuse. */
  it('needs a width and a height', () => {
    const refused = { refusal: 'Une zone a une largeur et une hauteur : cliquez le coin opposé.' }

    expect(rectangleOf([2.3, 43.2], [2.3, 43.25], EXTENT)).toEqual(refused)
    expect(rectangleOf([2.3, 43.2], [2.4, 43.2], EXTENT)).toEqual(refused)
  })

  it('is refused when a corner lies outside the extent', () => {
    expect(rectangleOf([2.3, 43.2], [2.35, 43.35], EXTENT)).toEqual({ refusal: OUTSIDE })
  })
})

describe('what the map draws for the form', () => {
  const parts = (drawing: ReturnType<typeof drawingOf>) =>
    drawing.features.map((one) => (one.properties as { part: string }).part)

  it('is the extent alone while nothing is placed', () => {
    expect(parts(drawingOf(EXTENT, null, undefined))).toEqual(['extent'])
  })

  it('is the place chosen, and the first corner of an area once clicked', () => {
    const drawing = drawingOf(EXTENT, { type: 'Point', coordinates: [2.35, 43.21] }, [2.3, 43.2])

    expect(parts(drawing)).toEqual(['extent', 'placed', 'vertex'])
  })
})
