import { describe, expect, it } from 'vitest'

import type { Report } from '@smmarchives/shared'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { contentOf, withEvent, type Ask } from '../src/useReplayContent.ts'
import { aMeasure, aReport, period } from './support/content.ts'

const REPORT: Report = {
  ranAt: '2026-09-12T08:00:00.000Z',
  request: {},
  sourcesWithoutData: [],
  fallbacks: [],
  failures: [],
}

function aManifest(datasets: readonly string[]): ReplayManifest {
  return {
    schemaVersion: 1,
    id: 'c4a7c5be-73d0-48db-aa17-8be7b314f863',
    label: null,
    extent: null,
    period,
    createdAt: '2026-09-12T08:00:00.000Z',
    updatedAt: '2026-09-12T08:00:00.000Z',
    state: 'complete',
    lanes: {},
    datasets: Object.fromEntries(datasets.map((name) => [name, { count: 0, report: REPORT }])),
    media: { copied: 0, failed: 0, bytes: 0 },
  }
}

/** An API that answers every data set with what the test hands it, and says what it was asked. */
function anApi(answers: Record<string, unknown>): { ask: Ask; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    ask: (name, filter) => {
      asked.push(`${name}${Object.keys(filter).length === 0 ? '' : ` ${JSON.stringify(filter)}`}`)
      return Promise.resolve(answers[name] ?? [])
    },
  }
}

describe('what a replay screen rests on', () => {
  it('asks for no data set the build did not produce', async () => {
    const { ask, asked } = anApi({})

    const content = await contentOf(aManifest(['events']), ask)

    expect(asked).toEqual(['events'])
    expect(content.stations).toEqual([])
    expect(content.rain).toBeUndefined()
    expect(content.measuredStations).toBeUndefined()
  })

  it('asks for the rain of the rain gauges alone, and gathers it by gauge', async () => {
    const { ask, asked } = anApi({
      measures: [aMeasure(4, '2019-10-22T06:00:00.000Z', 2, 'rainfall')],
    })

    const content = await contentOf(aManifest(['measures']), ask)

    expect(asked).toEqual(['measures {"family":"rain-gauge","quantity":"rainfall"}'])
    expect(content.rain?.has(4)).toBe(true)
  })

  it('reads the measured stations as a set', async () => {
    const { ask } = anApi({ 'measured-stations': [84, 2] })

    const content = await contentOf(aManifest(['measured-stations']), ask)

    expect(content.measuredStations).toEqual(new Set([84, 2]))
  })
})

describe('the events once an agent saved one', () => {
  it('hold it in place of the one of the same name', () => {
    const before = [aReport({ id: 'a', title: 'Avant' }), aReport({ id: 'b' })]

    const after = withEvent(before, aReport({ id: 'a', title: 'Après' }))

    expect(after.map((one) => [one.id, one.title])).toEqual([
      ['b', 'Route coupée'],
      ['a', 'Après'],
    ])
  })
})
