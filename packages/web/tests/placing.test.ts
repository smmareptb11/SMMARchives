import { describe, expect, it } from 'vitest'

import { areaOf, drawingOf, extentOf, pointAt, type Spot } from '../src/events/placing.ts'
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
  const triangle: Spot[] = [
    [2.3, 43.2],
    [2.4, 43.2],
    [2.35, 43.25],
  ]

  it('is closed on its first vertex, as GeoJSON wants a ring', () => {
    expect(areaOf(triangle, EXTENT)).toEqual({
      position: { type: 'Polygon', coordinates: [[...triangle, [2.3, 43.2]]] },
    })
  })

  it('needs three distinct vertices, not on one line, to enclose anything', () => {
    const refused = { refusal: 'Une zone a trois sommets au moins, qui ne sont pas alignés.' }

    expect(areaOf(triangle.slice(0, 2), EXTENT)).toEqual(refused)
    expect(areaOf([triangle[0]!, triangle[1]!, triangle[0]!], EXTENT)).toEqual(refused)
    expect(
      areaOf(
        [
          [2.3, 43.2],
          [2.35, 43.2],
          [2.4, 43.2],
        ],
        EXTENT,
      ),
    ).toEqual(refused)
  })

  it('is refused when its sides cross, as the API would refuse it', () => {
    expect(
      areaOf(
        [
          [2.3, 43.2],
          [2.4, 43.25],
          [2.4, 43.2],
          [2.3, 43.25],
        ],
        EXTENT,
      ),
    ).toEqual({ refusal: 'Les côtés de la zone ne doivent pas se croiser.' })
  })

  it('is refused when a vertex lies outside the extent', () => {
    const reachingOut: Spot[] = [
      [2.3, 43.2],
      [2.4, 43.2],
      [2.35, 43.35],
    ]

    expect(areaOf(reachingOut, EXTENT)).toEqual({ refusal: OUTSIDE })
  })
})

describe('what the small map draws', () => {
  const parts = (drawing: ReturnType<typeof drawingOf>) =>
    drawing.features.map((one) => (one.properties as { part: string }).part)

  it('is the extent alone while nothing is placed', () => {
    expect(parts(drawingOf(EXTENT, null, []))).toEqual(['extent'])
  })

  it('is the place chosen, the line traced so far and its vertices', () => {
    const drawing = drawingOf(EXTENT, { type: 'Point', coordinates: [2.35, 43.21] }, [
      [2.3, 43.2],
      [2.4, 43.2],
    ])

    expect(parts(drawing)).toEqual(['extent', 'placed', 'tracing', 'vertex', 'vertex'])
  })

  it('draws no line from a single vertex', () => {
    expect(parts(drawingOf(EXTENT, null, [[2.3, 43.2]]))).toEqual(['extent', 'vertex'])
  })
})
