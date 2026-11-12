import { describe, expect, it } from 'vitest'

import { crossingSource, frameOf, laneAsked, offsetFor, roomFor } from '../src/map/frame.ts'
import { aCamera, aCrossing, aGauge, aReport, aStation, held } from './support/content.ts'

const stations = [aStation(84, 'Trèbes', 'watercourse', { lon: 2.44, lat: 43.21 })]

describe('where the map goes to show an event', () => {
  it('centres on the station a crossing was read at', () => {
    expect(frameOf(aCrossing({ sourceId: 84 }), stations)).toEqual({
      kind: 'spot',
      at: [2.44, 43.21],
    })
  })

  it('centres on the spot an agent placed a report on', () => {
    const report = aReport({ id: 'r', position: { type: 'Point', coordinates: [2.5, 43.3] } })

    expect(frameOf(report, stations)).toEqual({ kind: 'spot', at: [2.5, 43.3] })
  })

  it('frames the whole of the area an agent traced', () => {
    const ring: [number, number][] = [
      [2.5, 43.3],
      [2.6, 43.3],
      [2.55, 43.4],
      [2.5, 43.3],
    ]
    const report = aReport({ id: 'r', position: { type: 'Polygon', coordinates: [ring] } })

    expect(frameOf(report, stations)).toEqual({
      kind: 'area',
      bounds: [
        [2.5, 43.3],
        [2.6, 43.4],
      ],
    })
  })

  it('goes nowhere for a report without a place', () => {
    expect(frameOf(aReport({ id: 'r' }), stations)).toBeUndefined()
  })

  it('goes nowhere for a station drawn nowhere', () => {
    const placeless = [aStation(84, 'Trèbes', 'watercourse', null)]

    expect(frameOf(aCrossing({ sourceId: 84 }), placeless)).toBeUndefined()
  })
})

describe('the room left around where the map goes', () => {
  /** The detail opens on the left: the station is shown between it and the legend. */
  it('keeps clear of the legend and of the left, for a crossing', () => {
    expect(roomFor(1400, 600, 'detail')).toEqual({ top: 40, right: 280, bottom: 40, left: 584 })
  })

  /** The sheet opens on the left: the report is shown between it and the legend. */
  it('keeps clear of the legend and of the left, for a report', () => {
    expect(roomFor(1000, 600, 'sheet')).toEqual({ top: 40, right: 280, bottom: 40, left: 404 })
  })

  /** 960 × 510 is the map of a 1440 × 900 screen, beside the history. */
  it('goes below the window when the room beside it is too narrow', () => {
    expect(roomFor(960, 510, 'detail')).toEqual({ top: 364, right: 280, bottom: 40, left: 40 })
  })

  it('never centres what it goes to under the window', () => {
    for (const [width, height] of [
      [960, 510],
      [1100, 510],
      [1200, 700],
      [900, 900],
    ] as const) {
      const room = roomFor(width, height, 'detail')
      const x = room.left + (width - room.left - room.right) / 2
      const y = room.top + (height - room.top - room.bottom) / 2
      const under = x <= 12 + 560 && y <= 12 + 340

      expect(under, `${String(width)} × ${String(height)}`).toBe(false)
    }
  })

  it("keeps only the legend's room on a map too small for both", () => {
    expect(roomFor(700, 400, 'detail')).toEqual({ top: 40, right: 280, bottom: 40, left: 40 })
  })
})

describe('the detail a card of the history opens', () => {
  it("opens a crossing's station, as the map draws it", () => {
    expect(crossingSource(stations, 84)).toEqual({
      kind: 'watercourse',
      id: 84,
      name: 'Trèbes',
      at: [2.44, 43.21],
    })
  })

  it('opens nothing for a crossing of a station the replay does not hold', () => {
    expect(crossingSource(stations, 99)).toBeUndefined()
  })
})

describe('the detail a lane opens from its name', () => {
  const camera = aCamera('215', 'Mailhac')
  const content = held({
    stations: [...stations, aStation(5, 'Sans repère', 'watercourse', null)],
    rainGauges: [aGauge(84, 'Couiza', 2.2)],
    webcams: [camera],
  })

  /** A station and a rain gauge can share a number: the family tells them apart. */
  it('opens a rain gauge as well as a station, each where it stands', () => {
    expect(laneAsked(content, { source: 'rain-gauge', id: 84 })).toEqual({
      opens: {
        kind: 'source',
        source: { kind: 'rain-gauge', id: 84, name: 'Couiza', at: [2.2, 43.4] },
      },
      frame: { kind: 'spot', at: [2.2, 43.4] },
    })
    expect(laneAsked(content, { source: 'watercourse', id: 84 })?.opens).toMatchObject({
      kind: 'source',
      source: { kind: 'watercourse', name: 'Trèbes' },
    })
  })

  it('opens a camera, where it stands', () => {
    expect(laneAsked(content, { camera: '215' })).toEqual({
      opens: { kind: 'camera', camera },
      frame: { kind: 'spot', at: [camera.position.lon, camera.position.lat] },
    })
  })

  it('asks nothing for what the map has nowhere to draw', () => {
    expect(laneAsked(content, { source: 'watercourse', id: 5 })).toBeUndefined()
    expect(laneAsked(content, { camera: '999' })).toBeUndefined()
  })

  /**
   * Saving, amending or removing an event changes the replay. What was asked
   * carries what it opens whole, so the map has nothing to read again from the
   * replay, and opens a detail on a click and on nothing else.
   */
  it('carries what it opens, unmoved by the replay changing after it', () => {
    const asked = laneAsked(content, { source: 'watercourse', id: 84 })
    const before = structuredClone(asked)
    content.events.push(aReport({ id: 'saved-afterwards' }))

    expect(asked).toEqual(before)
    expect(asked?.opens).toEqual({
      kind: 'source',
      source: { kind: 'watercourse', id: 84, name: 'Trèbes', at: [2.44, 43.21] },
    })
  })
})

describe('where a spot lands, clear of the window opened with it', () => {
  it('stands in the middle of the room left around it', () => {
    // 1400 × 600 with 584 px kept on the left and 280 on the right: the room
    // runs from 584 to 1120, its middle at 852, which is 152 right of 700.
    expect(offsetFor({ top: 40, right: 280, bottom: 40, left: 584 })).toEqual([152, 0])
  })

  it('moves down as the room is kept above it', () => {
    expect(offsetFor({ top: 300, right: 40, bottom: 40, left: 40 })).toEqual([0, 130])
  })

  it('stays at the centre when the room is even', () => {
    expect(offsetFor({ top: 24, right: 24, bottom: 24, left: 24 })).toEqual([0, 0])
  })
})
