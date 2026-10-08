import { ReportCollector, exitCodeFor, windowOf } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { AquasysClient } from '../src/sources/aquasys/client.ts'
import { fetchMeasures } from '../src/sources/aquasys/measures.ts'
import {
  aSeriesBeyondTheArgumentLimit,
  fetchStub,
  fixture,
  type StubbedResponse,
} from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://api.test/api', token: 'jeton', timeZone: 'UTC' }

const LEVELS = fixture('aquasys/measures-84-level.json')

/** The whole span the fixture covers, wide enough that nothing is cropped. */
const WHOLE = windowOf('2018-10-15T00:00:00Z', '2018-10-17T00:00:00Z')

async function collect(
  window = WHOLE,
  routes: Record<string, StubbedResponse> = { '/chronic/measures': { json: LEVELS } },
) {
  const collector = new ReportCollector({})
  const fetch = fetchStub(routes)
  const client = new AquasysClient({ config: CONFIG, fetch })
  const result = await fetchMeasures({
    client,
    collector,
    family: 'hydro',
    sourceIds: [84],
    quantities: ['level'],
    window,
  })
  return { ...result, fetch, collector, report: collector.seal() }
}

describe('decoding the positional response', () => {
  it('reads four columns and drops the rest, login included', async () => {
    const { measures } = await collect()

    expect(measures[0]).toEqual({
      sourceId: 84,
      quantity: 'level',
      at: '2018-10-15T00:05:00.000Z',
      value: 0.206,
    })
    expect(JSON.stringify(measures)).not.toContain('agent-a')
  })

  /**
   * The archive is thinner than the event was: station 84 tops out at 3.604 m
   * over these days while it also stores a "Crue du 15/10/2018" mark at 4.03 m.
   */
  it('finds the peak the archive still holds', async () => {
    const { measures } = await collect()
    expect(Math.max(...measures.map((measure) => measure.value))).toBe(3.604)
  })

  it('drops a row whose date or value is unreadable rather than guessing', async () => {
    const { measures, rowsDropped } = await collect(WHOLE, {
      '/chronic/measures': {
        json: [
          [84, 4, 1539561900000, 0.206, 0.206],
          [84, 4, null, 0.3, 0.3],
          [84, 4, 1539562200000, null, null],
        ],
      },
    })

    expect(measures).toHaveLength(1)
    expect(rowsDropped).toBe(2)
  })

  /** One bad row must not take the 899 good ones around it down with it. */
  it('drops a row whose epoch is out of range without losing the series', async () => {
    const { measures, rowsDropped, report } = await collect(WHOLE, {
      '/chronic/measures': {
        json: [
          [84, 4, 1539561900000, 0.206, 0.206],
          [84, 4, 0, 9.9, 9.9],
          [84, 4, 1539562200000, 0.305, 0.305],
        ],
      },
    })

    expect(measures.map((measure) => measure.value)).toEqual([0.206, 0.305])
    expect(rowsDropped).toBe(1)
    expect(exitCodeFor(report)).toBe(0)
  })

  it('keeps a series longer than one call can take as arguments', async () => {
    const rows = aSeriesBeyondTheArgumentLimit()
    const { measures, report } = await collect(WHOLE, { '/chronic/measures': { json: rows } })

    expect(measures).toHaveLength(rows.length)
    expect(exitCodeFor(report)).toBe(0)
  })
})

/**
 * Invariant 4 at its most dangerous point: `typeId` 5 is a flow on a station
 * and an evapotranspiration on a rain gauge, and rain is `typeId` 1 on a rain
 * gauge and nothing at all on a station. Reading rain through the hydro table
 * would leave the whole suite green while rainfall became uncollectable.
 */
describe('the rain gauge path', () => {
  it('reads rain through its own table, and its own endpoint', async () => {
    const collector = new ReportCollector({})
    const fetch = fetchStub({
      '/pluviometer/chartMeasures': { json: [[4, 1, 1539561900000, 12.5, 12.5]] },
    })
    const client = new AquasysClient({ config: CONFIG, fetch })

    const { measures } = await fetchMeasures({
      client,
      collector,
      family: 'rain-gauge',
      sourceIds: [4],
      quantities: ['rainfall'],
      window: WHOLE,
    })

    expect(new URL(fetch.calls[0]!).searchParams.get('dataType')).toBe('1')
    expect(measures).toEqual([
      { sourceId: 4, quantity: 'rainfall', at: '2018-10-15T00:05:00.000Z', value: 12.5 },
    ])
  })

  it('refuses a quantity the family does not carry rather than reading another', async () => {
    const collector = new ReportCollector({})
    const fetch = fetchStub({ '/pluviometer/chartMeasures': { json: [] } })
    const client = new AquasysClient({ config: CONFIG, fetch })

    const { measures } = await fetchMeasures({
      client,
      collector,
      family: 'rain-gauge',
      sourceIds: [4],
      quantities: ['level'],
      window: WHOLE,
    })

    expect(measures).toEqual([])
    expect(fetch.calls).toHaveLength(0)
    expect(collector.seal().fallbacks).toMatchObject([
      { rule: 'level is in no rain-gauge data type table', applied: 'quantity skipped' },
    ])
  })
})

describe('the window the API widens', () => {
  it('sends the bounds in the query string and in the body alike', async () => {
    const { fetch } = await collect()

    const url = new URL(fetch.calls[0]!)
    expect(url.searchParams.get('stationId')).toBe('84')
    expect(url.searchParams.get('dataType')).toBe('4')
    expect(url.searchParams.get('startDate')).toBe(String(Date.UTC(2018, 9, 15)))
  })

  it('never sends groupFunc, which fails silently', async () => {
    const { fetch } = await collect()
    expect(fetch.calls[0]).not.toContain('groupFunc')
  })

  it('crops the extra days off after receipt', async () => {
    const { measures } = await collect(windowOf('2018-10-15T17:00:00Z', '2018-10-15T22:00:00Z'))

    expect(measures).toHaveLength(6)
    expect(measures.at(0)?.at).toBe('2018-10-15T17:12:00.000Z')
    expect(measures.at(-1)?.at).toBe('2018-10-15T21:26:00.000Z')
  })
})

describe('the density a replay actually obtained', () => {
  it('is measured rather than assumed regular', async () => {
    const { density } = await collect(windowOf('2018-10-15T17:00:00Z', '2018-10-15T22:00:00Z'))

    expect(density).toEqual([{ sourceId: 84, quantity: 'level', medianStepMinutes: 50 }])
  })

  /**
   * A station returns its level and its flow on the same timestamps, so a
   * median over the two interleaved would read as a zero-minute step.
   */
  it('keeps one quantity from flattening another', async () => {
    const collector = new ReportCollector({})
    const client = new AquasysClient({
      config: CONFIG,
      fetch: fetchStub({ '/chronic/measures': { json: LEVELS } }),
    })
    const { density } = await fetchMeasures({
      client,
      collector,
      family: 'hydro',
      sourceIds: [84],
      quantities: ['level', 'flow'],
      window: windowOf('2018-10-15T17:00:00Z', '2018-10-15T22:00:00Z'),
    })

    expect(density).toEqual([
      { sourceId: 84, quantity: 'level', medianStepMinutes: 50 },
      { sourceId: 84, quantity: 'flow', medianStepMinutes: 50 },
    ])
  })
})

describe('a source with nothing over the period', () => {
  it('is an absence, not a failure', async () => {
    const { measures, report } = await collect(WHOLE, {
      '/chronic/measures': { json: [] },
    })

    expect(measures).toEqual([])
    expect(report.sourcesWithoutData).toEqual([84])
    expect(exitCodeFor(report)).toBe(0)
  })

  it('is also an absence when everything falls outside the window', async () => {
    const { measures, report } = await collect(
      windowOf('2019-01-01T00:00:00Z', '2019-01-02T00:00:00Z'),
    )

    expect(measures).toEqual([])
    expect(report.sourcesWithoutData).toEqual([84])
    expect(report.failures).toEqual([])
  })
})

describe('a source the API cannot serve', () => {
  it('carries the opaque status and body into the report', async () => {
    const { report } = await collect(WHOLE, {
      '/chronic/measures': { status: 500, body: '' },
    })

    expect(report.failures).toMatchObject([{ subject: 'source 84 level', status: 500 }])
    expect(exitCodeFor(report)).toBe(2)
  })
})
