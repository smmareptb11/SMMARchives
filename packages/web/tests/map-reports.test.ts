import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import { familiesOf } from '../src/map/families.ts'
import {
  clickedOf,
  phaseAt,
  POINT_HELD_MS,
  reportFilterOf,
  reportPaintingAt,
  reportsOnTheMap,
  reportUnder,
  samePainting,
  type ReportPainting,
} from '../src/map/reports.ts'
import { aCrossing, aReport, at, held } from './support/content.ts'

const SPOT = { type: 'Point' as const, coordinates: [2.35, 43.21] as [number, number] }
const AREA = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [2.3, 43.2],
      [2.4, 43.2],
      [2.4, 43.25],
      [2.3, 43.2],
    ] as [number, number][],
  ],
}

describe('where a report stands at an instant', () => {
  const span = aReport({
    id: 'a',
    from: '2019-10-22T06:00:00.000Z',
    to: '2019-10-22T08:00:00.000Z',
  })

  it('is not drawn before it begins, green while under way, grey once over', () => {
    expect(phaseAt(span, at('2019-10-22T05:59:59.000Z'))).toBe('before')
    expect(phaseAt(span, at('2019-10-22T06:00:00.000Z'))).toBe('during')
    expect(phaseAt(span, at('2019-10-22T08:00:00.000Z'))).toBe('during')
    expect(phaseAt(span, at('2019-10-22T08:00:01.000Z'))).toBe('after')
  })

  /**
   * Green for its instant alone, a report with no end would be green on no
   * frame of a reading at speed.
   */
  it('keeps a report with no end green for a quarter of an hour', () => {
    const point = aReport({ id: 'b', from: '2019-10-22T06:00:00.000Z' })
    const from = at(point.from)

    expect(POINT_HELD_MS).toBe(15 * 60_000)
    expect(phaseAt(point, from + POINT_HELD_MS)).toBe('during')
    expect(phaseAt(point, from + POINT_HELD_MS + 1)).toBe('after')
  })
})

describe('what the map draws of the reports', () => {
  const reports = [
    aReport({ id: 'spot', position: SPOT }),
    aReport({ id: 'area', position: AREA }),
    aReport({ id: 'nowhere' }),
    aCrossing({ sourceId: 84, position: SPOT }),
  ]

  it('is the reports placed somewhere, spot or area, and never a crossing', () => {
    expect(reportsOnTheMap(reports).features).toEqual([
      { type: 'Feature', geometry: AREA, properties: { report: 'area' } },
      { type: 'Feature', geometry: SPOT, properties: { report: 'spot' } },
    ])
  })

  it('names which are under way and which are over, leaving out those not reached', () => {
    const later = aReport({ id: 'later', from: '2019-10-22T12:00:00.000Z', position: SPOT })
    const over = aReport({ id: 'over', from: '2019-10-22T01:00:00.000Z', position: SPOT })

    expect(reportPaintingAt([...reports, later, over], at('2019-10-22T06:05:00.000Z'))).toEqual({
      during: ['area', 'spot'],
      after: ['over'],
    })
  })

  it('tells a painting that changed from one that did not', () => {
    const one: ReportPainting = { during: ['a'], after: [] }

    expect(samePainting(one, { during: ['a'], after: [] })).toBe(true)
    expect(samePainting(one, { during: [], after: ['a'] })).toBe(false)
  })
})

describe('the filter of a report layer', () => {
  const painting: ReportPainting = { during: ['spot'], after: ['old'] }

  function draws(shape: 'Point' | 'Polygon', report: string, type: 1 | 3): boolean {
    const filter = featureFilter(reportFilterOf(painting, shape), 'layers[0].filter')
    return filter.filter({ zoom: 10 }, { type, properties: { report } })
  }

  it('draws a report the cursor has reached, under way or over', () => {
    expect(draws('Point', 'spot', 1)).toBe(true)
    expect(draws('Point', 'old', 1)).toBe(true)
  })

  it('draws nothing of a report the cursor has not reached', () => {
    expect(draws('Point', 'later', 1)).toBe(false)
  })

  it('keeps an area off the layer of the diamonds', () => {
    expect(draws('Point', 'spot', 3)).toBe(false)
    expect(draws('Polygon', 'spot', 3)).toBe(true)
  })
})

describe('a click on the map', () => {
  it('lands on the report under the pointer', () => {
    expect(
      reportUnder([{ properties: { kind: 'watercourse' } }, { properties: { report: 'a' } }]),
    ).toBe('a')
  })

  it('finds no report where there is none', () => {
    expect(
      reportUnder([{ properties: { kind: 'watercourse' } }, { properties: null }]),
    ).toBeUndefined()
  })
})

describe('what a click is about', () => {
  it('is the diamond, over the station it stands on', () => {
    expect(clickedOf({ spot: 'a', source: 'Trèbes', area: 'b' })).toEqual({ report: 'a' })
  })

  it('is the station, over the area that covers it', () => {
    expect(clickedOf({ spot: undefined, source: 'Trèbes', area: 'b' })).toEqual({
      source: 'Trèbes',
    })
  })

  it('is the area where nothing else stands', () => {
    expect(clickedOf({ spot: undefined, source: undefined, area: 'b' })).toEqual({ report: 'b' })
  })

  it('is nothing on empty ground', () => {
    expect(clickedOf({ spot: undefined, source: undefined, area: undefined })).toBeUndefined()
  })
})

describe('the switch on the reports', () => {
  it('is there when a report is placed on the map', () => {
    expect(familiesOf(held({ events: [aReport({ id: 'a', position: SPOT })] }))).toEqual([
      'report',
      'territory',
    ])
  })

  it('is not there for reports placed nowhere, which the lanes alone show', () => {
    expect(familiesOf(held({ events: [aReport({ id: 'a' })] }))).toEqual(['territory'])
  })
})
