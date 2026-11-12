import { describe, expect, it } from 'vitest'

import {
  cascadeOf,
  closing,
  frontOf,
  keyOf,
  opening,
  raising,
  type Subject,
} from '../src/map/windows.ts'
import { aCamera } from './support/content.ts'

const station = (id: number): Subject => ({
  kind: 'source',
  source: { kind: 'watercourse', id, name: `Station ${String(id)}`, at: [2.4, 43.2] },
})
const gauge = (id: number): Subject => ({
  kind: 'source',
  source: { kind: 'rain-gauge', id, name: `Pluviomètre ${String(id)}`, at: [2.4, 43.2] },
})

describe('the windows over the map', () => {
  it('opens one per source, the last opened in front', () => {
    const windows = opening(opening([], station(1)), station(2))

    expect(windows.map((one) => one.key)).toEqual(['watercourse:1', 'watercourse:2'])
    expect(frontOf(windows)).toBe('watercourse:2')
  })

  it('brings a source already open forward rather than opening it twice', () => {
    const windows = opening(opening(opening([], station(1)), station(2)), station(1))

    expect(windows).toHaveLength(2)
    expect(frontOf(windows)).toBe('watercourse:1')
  })

  it('tells a station from a rain gauge of the same number', () => {
    expect(keyOf(station(7))).not.toBe(keyOf(gauge(7)))
    expect(opening(opening([], station(7)), gauge(7))).toHaveLength(2)
  })

  it('names a camera by its code', () => {
    expect(keyOf({ kind: 'camera', camera: aCamera('215') })).toBe('camera:215')
  })

  it('opens a report beside the sources, once', () => {
    const report: Subject = { kind: 'report', id: 'r1' }
    const windows = opening(opening(opening([], station(1)), report), report)

    expect(windows.map((one) => one.key)).toEqual(['watercourse:1', 'report:r1'])
  })

  it('brings any window forward, and leaves the list alone when it already is', () => {
    const windows = opening(opening([], station(1)), station(2))

    expect(frontOf(raising(windows, 'watercourse:1'))).toBe('watercourse:1')
    expect(raising(windows, 'watercourse:2')).toBe(windows)
  })

  it('closes one window and leaves the others open', () => {
    const windows = closing(opening(opening([], station(1)), station(2)), 'watercourse:2')

    expect(windows.map((one) => one.key)).toEqual(['watercourse:1'])
    expect(frontOf(windows)).toBe('watercourse:1')
    expect(frontOf(closing(windows, 'watercourse:1'))).toBeUndefined()
  })

  it('opens each window a step further in the cascade, in the first free one', () => {
    const three = opening(opening(opening([], station(1)), station(2)), station(3))
    expect(three.map((one) => one.step)).toEqual([0, 1, 2])

    const reopened = opening(closing(three, 'watercourse:2'), station(4))
    expect(reopened.find((one) => one.key === 'watercourse:4')?.step).toBe(1)
  })

  it('places the cascade downwards from the corner, a title bar at a time', () => {
    expect(cascadeOf(0)).toEqual({ x: 0, y: 0 })
    expect(cascadeOf(2)).toEqual({ x: 48, y: 112 })
  })
})
