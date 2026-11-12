import { describe, expect, it } from 'vitest'

import { DRAWN } from '../src/map/layers.ts'
import { MARGIN, placed } from '../src/map/framing.ts'
import { openingOf, seesAll } from '../src/map/sources.ts'
import { aGauge, aStation, held } from './support/content.ts'

/** A replay of the basin, and a rain gauge far out of it. */
const basin = held({
  stations: [
    aStation(1, 'Carcassonne', 'watercourse', { lon: 2.35, lat: 43.21 }),
    aStation(2, 'Digue de Cuxac', 'structure', { lon: 3.0, lat: 43.24 }),
  ],
  rainGauges: [aGauge(9, 'Loin', 4.2, { lon: 4.2, lat: 42.5 })],
})

const PHONE = { width: 390, height: 662 }

describe('where the map opens on a phone', () => {
  it('frames the stations and the structures, and not the rain gauges far past them', () => {
    expect(openingOf(basin, PHONE, true)?.bounds).toEqual([
      [2.35, 43.21],
      [3.0, 43.24],
    ])
  })

  /** Its legend folds into a button at the top, which the stations are kept clear of. */
  it('keeps the stations clear of the layers button', () => {
    const button = { left: 270, top: 12, right: 378, bottom: 52 }
    const opening = openingOf(basin, PHONE, true, button)
    const points: [number, number][] = [
      [2.35, 43.21],
      [3.0, 43.24],
    ]

    const landed = opening === undefined ? [] : placed(points, PHONE, opening.padding)

    expect(landed).toHaveLength(2)
    expect(landed.every(([x, y]) => x < button.left - 12 || y > button.bottom + 12)).toBe(true)
  })

  it('frames the rain gauges of a replay holding no station', () => {
    const gauges = held({ rainGauges: [aGauge(9, 'Loin', 4.2, { lon: 4.2, lat: 42.5 })] })

    expect(openingOf(gauges, PHONE, true)?.bounds).toEqual([
      [4.2, 42.5],
      [4.2, 42.5],
    ])
  })

  it('frames nothing for a replay holding nothing placed', () => {
    expect(openingOf(held(), PHONE, true)).toBeUndefined()
  })
})

describe('where the map opens on a wider screen', () => {
  it('frames every source, as close as an even margin allows when nothing covers them', () => {
    expect(openingOf(basin, { width: 960, height: 611 }, false)).toEqual({
      bounds: [
        [2.35, 42.5],
        [4.2, 43.24],
      ],
      padding: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
    })
  })
})

describe('the order the families are drawn in', () => {
  /** Wider and three times as many, rain gauges drawn on top hide the stations. */
  it('draws the rain gauges underneath, and the stations on top', () => {
    expect(DRAWN).toEqual(['rain-gauge', 'structure', 'watercourse'])
  })
})

describe('whether the map shows every source it opened on', () => {
  const bounds: [[number, number], [number, number]] = [
    [2.35, 43.21],
    [3.0, 43.24],
  ]
  const opened = { west: 2.2, south: 43.1, east: 3.2, north: 43.4 }

  it('does on the view it opened on, and on any wider one', () => {
    expect(seesAll(opened, bounds)).toBe(true)
    expect(seesAll({ west: 1, south: 42, east: 4, north: 44 }, bounds)).toBe(true)
  })

  it('does not once zoomed in on part of them', () => {
    expect(seesAll({ west: 2.3, south: 43.2, east: 2.5, north: 43.3 }, bounds)).toBe(false)
  })

  it('does not once moved off them, even by one side', () => {
    expect(seesAll({ ...opened, east: 2.9 }, bounds)).toBe(false)
    expect(seesAll({ ...opened, south: 43.22 }, bounds)).toBe(false)
  })
})
