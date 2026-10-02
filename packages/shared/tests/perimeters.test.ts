import { describe, expect, it } from 'vitest'

import { contains } from '../src/contracts/geometry.ts'
import { BASIN_BOUNDS, UNIONS, boundingBoxOf } from '../src/reference/perimeters.ts'

function verticesOf(geometry: unknown): { lon: number; lat: number }[] {
  const vertices: { lon: number; lat: number }[] = []
  const walk = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return
    if (typeof coordinates[0] === 'number') {
      vertices.push({ lon: coordinates[0], lat: coordinates[1] as number })
      return
    }
    coordinates.forEach(walk)
  }
  walk((geometry as { coordinates: unknown }).coordinates)
  return vertices
}

describe('the bounding box of a geometry', () => {
  it('holds every vertex of a multipolygon, holes and parts alike', () => {
    const geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [2, 43],
            [2.5, 43],
            [2.5, 43.2],
            [2, 43],
          ],
        ],
        [
          [
            [1.9, 42.8],
            [2.1, 42.8],
            [2.1, 42.9],
            [1.9, 42.8],
          ],
        ],
      ],
    }

    expect(boundingBoxOf(geometry)).toEqual({
      minLon: 1.9,
      minLat: 42.8,
      maxLon: 2.5,
      maxLat: 43.2,
    })
  })

  it('is nothing for a geometry with no vertex', () => {
    expect(boundingBoxOf(null)).toBeUndefined()
    expect(boundingBoxOf({ type: 'Polygon', coordinates: [] })).toBeUndefined()
  })
})

describe('the perimeters of the territory', () => {
  it('are the seven basin unions', () => {
    expect(UNIONS.map((one) => one.code)).toEqual([
      'sbvoj',
      'siahbr',
      'siahcm',
      'smac',
      'smahf',
      'smda',
      'smhva',
    ])
  })

  it('have a rectangle holding their whole outline', () => {
    for (const perimeter of UNIONS) {
      const outside = verticesOf(perimeter.outline.geometry).filter(
        (vertex) => !contains(perimeter.bounds, vertex),
      )
      expect(outside, perimeter.code).toEqual([])
    }
  })
})

describe('the rectangle of the basin', () => {
  // What the Lizmap's own `perimetre_smmar` spans, to four metres: the
  // simplification moves each outline on its own.
  it('spans the territory of the SMMAR', () => {
    expect(BASIN_BOUNDS).toEqual({
      minLon: 1.79768,
      minLat: 42.53356,
      maxLon: 3.25196,
      maxLat: 43.47221,
    })
  })
})
