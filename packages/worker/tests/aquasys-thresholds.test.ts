import { ReportCollector, exitCodeFor } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { AquasysClient } from '../src/sources/aquasys/client.ts'
import { fetchThresholds } from '../src/sources/aquasys/thresholds.ts'
import { fetchStub, fixture, type StubbedResponse } from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://api.test/api', token: 'jeton', timeZone: 'UTC' }

async function classify(sourceIds: number[], routes: Record<string, StubbedResponse>) {
  const collector = new ReportCollector('fetch:aquasys:thresholds', {})
  const client = new AquasysClient({ config: CONFIG, fetch: fetchStub(routes) })
  const thresholds = await fetchThresholds({ client, collector, family: 'hydro', sourceIds })
  return { thresholds, report: collector.seal() }
}

const station = (id: number, name: string): [string, StubbedResponse] => [
  `/hydrologicalStation/${id}/threshold`,
  { json: fixture(`aquasys/${name}`) },
]

describe('a station whose thresholds carry their category', () => {
  it('separates alert levels from historical flood marks, with no inference', async () => {
    const { thresholds, report } = await classify(
      [84],
      Object.fromEntries([station(84, 'thresholds-84.json')]),
    )

    const levels = thresholds.filter((threshold) => threshold.quantity === 'level')
    expect(
      levels
        .filter((threshold) => threshold.nature === 'alert-level')
        .map((threshold) => threshold.label),
    ).toEqual(['Vigilance', 'Alerte', 'Crise'])
    expect(levels.filter((threshold) => threshold.nature === 'flood-mark')).toHaveLength(4)
    expect(levels.every((threshold) => !threshold.natureIsFallback)).toBe(true)
    expect(report.fallbacks).toHaveLength(2)
  })

  it('reads a drought ladder as such, including the two rungs that declare nothing', async () => {
    const { thresholds, report } = await classify(
      [84],
      Object.fromEntries([station(84, 'thresholds-84.json')]),
    )

    const flows = thresholds.filter((threshold) => threshold.quantity === 'flow')
    expect(flows).toHaveLength(4)
    expect(flows.every((threshold) => threshold.nature === 'drought-threshold')).toBe(true)

    const inferred = flows
      .filter((threshold) => threshold.natureIsFallback)
      .map((threshold) => threshold.label)
    expect(inferred).toEqual(["Débit d'alerte", "Débit d'alerte renforcée"])
    expect(report.fallbacks.map((f) => f.applied)).toContain(
      'drought threshold, from the rest of the ladder on this quantity',
    )
  })

  it('keeps identifiers that repeat across quantities apart', async () => {
    const { thresholds } = await classify(
      [84],
      Object.fromEntries([station(84, 'thresholds-84.json')]),
    )

    const first = thresholds.filter((threshold) => threshold.id === 1)
    expect(first.map((threshold) => threshold.quantity).sort()).toEqual(['flow', 'level'])
  })
})

describe('a station whose thresholds carry no category', () => {
  it('still reads the ladder, and says the nature was inferred', async () => {
    const { thresholds, report } = await classify(
      [85],
      Object.fromEntries([station(85, 'thresholds-85.json')]),
    )

    expect(thresholds).toHaveLength(3)
    expect(thresholds.every((threshold) => threshold.nature === 'alert-level')).toBe(true)
    expect(thresholds.every((threshold) => threshold.natureIsFallback)).toBe(true)
    expect(report.fallbacks).toHaveLength(3)
    expect(report.fallbacks[0]).toMatchObject({
      subject: 'source 85, threshold 1 "Vigilance"',
      rule: 'no category',
      applied: 'alert level, the remaining nature',
    })
  })
})

describe('a source with no threshold', () => {
  it('is an absence, not a failure', async () => {
    const { thresholds, report } = await classify([4], {
      '/hydrologicalStation/4/threshold': { json: [] },
    })

    expect(thresholds).toEqual([])
    expect(report.sourcesWithoutData).toEqual([4])
    expect(report.failures).toEqual([])
    expect(exitCodeFor(report)).toBe(0)
  })
})

describe('when one source out of several fails', () => {
  it('keeps the others and reports the failure', async () => {
    const { thresholds, report } = await classify([84, 85], {
      '/hydrologicalStation/84/threshold': { status: 500 },
      '/hydrologicalStation/85/threshold': { json: fixture('aquasys/thresholds-85.json') },
    })

    expect(thresholds).toHaveLength(3)
    expect(report.failures).toMatchObject([{ subject: 'source 84 thresholds', status: 500 }])
    expect(exitCodeFor(report)).toBe(2)
  })
})

describe('a threshold on an unmapped data type', () => {
  it('is dropped and reported rather than read as the wrong quantity', async () => {
    const { thresholds, report } = await classify([1], {
      '/hydrologicalStation/1/threshold': {
        json: [{ id: 1, name: 'Inconnu', value: 1, dataType: '42' }],
      },
    })

    expect(thresholds).toEqual([])
    expect(report.fallbacks[0]).toMatchObject({
      rule: 'dataType 42 is in no hydro data type table',
      applied: 'threshold dropped',
    })
  })
})

describe('the colour of a threshold', () => {
  it('is the API colour, and null rather than invented when absent', async () => {
    const { thresholds } = await classify(
      [84],
      Object.fromEntries([station(84, 'thresholds-84.json')]),
    )

    expect(thresholds.find((threshold) => threshold.label === 'Crise')?.color).toBe('#ff0000')
    expect(
      thresholds.find((threshold) => threshold.label === 'Crue du 15/10/2018')?.color,
    ).toBeNull()
    expect(thresholds.filter((threshold) => threshold.color === null)).toHaveLength(5)
  })
})
