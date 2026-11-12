import { describe, expect, it } from 'vitest'

import { clearOf, MARGIN, placed, type Rect } from '../src/map/framing.ts'

/** Sources spread over the basin, from Limoux to the coast, one of them up by Béziers. */
const basin: [number, number][] = [
  [1.81, 42.5],
  [2.35, 43.21],
  [3.0, 43.24],
  [3.35, 43.49],
]

const MAP = { width: 1000, height: 710 }
const even = { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }

/** Whether no point lands under the rectangle, symbols included. */
const clearUnder = (points: [number, number][], legend: Rect) =>
  points.every(
    ([x, y]) =>
      x < legend.left - 12 ||
      x > legend.right + 12 ||
      y < legend.top - 12 ||
      y > legend.bottom + 12,
  )

describe('the room left around the sources', () => {
  it('is an even margin when nothing is laid over the map', () => {
    expect(clearOf(basin, MAP, undefined)).toEqual(even)
  })

  /** The legend covers a corner: reserving its width down the whole side costs half a zoom. */
  it('is an even margin when the legend covers none of them', () => {
    const corner = { left: 900, top: 650, right: 990, bottom: 700 }

    expect(clearOf(basin, MAP, corner)).toEqual(even)
  })

  it('keeps every source clear of a legend that would cover one', () => {
    const legend = { left: 770, top: 12, right: 988, bottom: 262 }
    const padding = clearOf(basin, MAP, legend)

    expect(padding).not.toEqual(even)
    expect(clearUnder(placed(basin, MAP, padding), legend)).toBe(true)
  })

  it('is as close as a framing that stays clear of the legend allows', () => {
    const legend = { left: 770, top: 12, right: 988, bottom: 262 }
    const beside = { ...even, right: MAP.width - legend.left + MARGIN }
    const below = { ...even, top: legend.bottom + MARGIN }
    const spread = (padding: typeof even) => {
      const xs = placed(basin, MAP, padding).map(([x]) => x)
      return Math.max(...xs) - Math.min(...xs)
    }
    const chosen = clearOf(basin, MAP, legend)

    for (const other of [beside, below]) {
      if (clearUnder(placed(basin, MAP, other), legend)) {
        expect(spread(chosen)).toBeGreaterThanOrEqual(spread(other))
      }
    }
  })
})

describe('where the sources land once framed', () => {
  it('reaches the margin on the side that limits the zoom, and stays inside on the other', () => {
    const landed = placed(basin, MAP, even)
    const xs = landed.map(([x]) => x)
    const ys = landed.map(([, y]) => y)
    const touches = (value: number, edge: number) => Math.abs(value - edge) < 1e-6

    expect(
      (touches(Math.min(...xs), MARGIN) && touches(Math.max(...xs), MAP.width - MARGIN)) ||
        (touches(Math.min(...ys), MARGIN) && touches(Math.max(...ys), MAP.height - MARGIN)),
    ).toBe(true)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(MARGIN - 1e-6)
    expect(Math.max(...ys)).toBeLessThanOrEqual(MAP.height - MARGIN + 1e-6)
  })

  /** North is up: the source furthest north lands highest. */
  it('puts the north at the top', () => {
    const landed = placed(basin, MAP, even)

    expect(landed[3]?.[1]).toBeLessThan(landed[0]?.[1] ?? 0)
  })
})
