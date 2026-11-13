import { describe, expect, it } from 'vitest'

import type { JournalEntry, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { settled, stagesOf } from '../src/build/stages.ts'

const AT = '2026-11-04T10:00:00.000Z'

/** Lines as the worker wrote them for « 2026 10 28 Semaine récente avec webcams ». */
const line = (lane: JournalEntry['lane'], message: string): JournalEntry => ({
  at: AT,
  lane,
  kind: 'progress',
  message,
})

type Lanes = ReplayManifest['lanes']
type State = NonNullable<Lanes[keyof Lanes]>['state']

const lanesOf = (states: Partial<Record<keyof Lanes, State>>): Lanes =>
  Object.fromEntries(Object.entries(states).map(([name, state]) => [name, { state }]))

const step = (lanes: Lanes, journal: JournalEntry[], lane: string) =>
  stagesOf(lanes, journal).find((one) => one.lane === lane)

describe('where a strand of a build stands', () => {
  const running = lanesOf({ aquasys: 'running', lizmap: 'running', 'radar-rainfall': 'running' })

  it('reads the last thing it said, in French, with how far along', () => {
    const journal = [
      line('aquasys', 'hydrological stations…'),
      line('aquasys', '  station details 50/89'),
    ]
    expect(step(running, journal, 'aquasys')).toMatchObject({
      step: 'Fiches des stations',
      done: 50,
      total: 89,
    })
  })

  it('tells the measures of the stations from those of the rain gauges', () => {
    const stations = [
      line('aquasys', 'measures of 89 hydro source(s)…'),
      line('aquasys', '  measures 125/178'),
    ]
    const gauges = [
      ...stations,
      line('aquasys', 'measures of 87 rain-gauge source(s)…'),
      line('aquasys', '  measures 50/87'),
    ]

    expect(step(running, stations, 'aquasys')).toMatchObject({
      step: 'Mesures des stations',
      done: 125,
      total: 178,
    })
    expect(step(running, gauges, 'aquasys')).toMatchObject({
      step: 'Mesures des pluviomètres',
      done: 50,
      total: 87,
    })
  })

  it('reads the webcams and the radar in their own terms', () => {
    const journal = [
      line('lizmap', '  webcam 606…'),
      line('lizmap', '  images 50/68'),
      line('radar-rainfall', '  delivery 20034…'),
    ]
    expect(step(running, journal, 'lizmap')).toMatchObject({
      step: 'Copie des images des webcams',
      done: 50,
      total: 68,
    })
    expect(step(running, journal, 'radar-rainfall')).toMatchObject({
      step: 'Lecture des livraisons radar',
      total: undefined,
    })
  })

  it('keeps a strand at its state alone when it does not know the line', () => {
    expect(step(running, [line('aquasys', 'something new')], 'aquasys')).toMatchObject({
      state: 'running',
      step: undefined,
    })
  })

  it('puts the sources first, then what is derived from them', () => {
    const lanes = lanesOf({
      media: 'pending',
      events: 'pending',
      lizmap: 'done',
      aquasys: 'done',
    })
    expect(stagesOf(lanes, []).map((one) => one.lane)).toEqual([
      'aquasys',
      'lizmap',
      'events',
      'media',
    ])
  })
})

describe('how many strands are over', () => {
  it('counts a failed strand as over, and a running one as not', () => {
    const lanes = lanesOf({
      aquasys: 'done',
      lizmap: 'failed',
      events: 'running',
      media: 'pending',
    })
    expect(settled(stagesOf(lanes, []))).toEqual({ over: 2, of: 4 })
  })

  it('counts the strands the build planned, begun or not, and no other', () => {
    const lanes = lanesOf({ aquasys: 'done', lizmap: 'running', events: 'pending' })
    expect(settled(stagesOf(lanes, []))).toEqual({ over: 1, of: 3 })
    expect(stagesOf(lanes, []).map((one) => one.lane)).not.toContain('radar-rainfall')
  })
})
