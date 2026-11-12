import { ReportCollector, type BoundingBox, type Fallback } from '@smmarchives/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { AquasysClient } from '../src/sources/aquasys/client.ts'
import { rawNetworkLinkSchema } from '../src/sources/aquasys/raw.ts'
import { fetchRainGauges, fetchStations } from '../src/sources/aquasys/stations.ts'
import { fetchStub, fixture, stationReferentialRoutes } from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://api.test/api', token: 'jeton' }

/** The detail of every source the fixtures list, which a referential always reads. */
const DETAILS = {
  '/hydrologicalStation/84': { json: fixture('aquasys/station-84-detail.json') },
  '/hydrologicalStation/2': { json: { id: 2, link_pointPrels: [] } },
  '/hydrologicalStation/152': { json: { id: 152 } },
  '/pluviometer/4': { json: fixture('aquasys/rain-gauge-4-detail.json') },
  '/pluviometer/737': { json: { id: 737 } },
  '/pluviometer/744': { json: { id: 744 } },
}

function collect(
  routes: Parameters<typeof fetchStub>[0],
  extent: BoundingBox | undefined = undefined,
) {
  const collector = new ReportCollector({})
  const fetch = fetchStub({ ...DETAILS, ...routes })
  const client = new AquasysClient({ config: CONFIG, fetch, minIntervalMs: 0 })
  return { client, collector, fetch, extent }
}

describe('the hydrological station referential', () => {
  it('reprojects, types, and keeps no referential date', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(stations).toHaveLength(3)
    const berre = stations.find((station) => station.id === 84)
    expect(berre).toMatchObject({
      id: 84,
      code: 'Y082401001',
      category: 'watercourse',
    })
    expect(stations.find((station) => station.id === 2)?.category).toBe('structure')
    expect(stations.find((station) => station.id === 152)?.category).toBe('watercourse')
    expect(berre?.position?.lon).toBeCloseTo(2.83, 2)
    expect(berre?.position?.lat).toBeCloseTo(43.04, 2)
    expect(berre).not.toHaveProperty('creationDate')
    expect(berre).not.toHaveProperty('closeDate')
  })

  it('never lets a nominative login through', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(JSON.stringify(stations)).not.toContain('agent-a')
    expect(JSON.stringify(stations)).not.toContain('updateLogin')
  })

  it('leaves out a station its networks type both ways, and says so', async () => {
    const links = [
      ...(fixture('aquasys/network-links.json') as unknown[]),
      { idStation: 84, idNetwork: 4 },
    ]
    const options = collect({
      ...stationReferentialRoutes(),
      '/hydrologicalStation/networkLink': { json: links },
    })
    const stations = await fetchStations(options)

    expect(stations.map((station) => station.id)).toEqual([2, 152])
    expect(options.collector.seal().fallbacks).toContainEqual({
      subject: 'station 84',
      rule: 'on both structure and watercourse networks',
      applied: 'station dropped',
    })
  })

  it('leaves out an out-of-scope station before any detail call', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(stations.map((station) => station.id)).toEqual([84, 2, 152])
    expect(options.fetch.calls.some((call) => call.includes('/hydrologicalStation/24'))).toBe(false)
  })

  it('says which stations it left out for want of a typing network', async () => {
    const options = collect(stationReferentialRoutes())
    await fetchStations(options)

    expect(options.collector.seal().fallbacks).toEqual([
      {
        subject: 'stations 24',
        rule: 'on no network that types a station',
        applied: 'stations dropped',
      },
    ])
  })

  it('reads what a station measures from its measurement points', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(stations.find((station) => station.id === 84)?.quantities).toEqual(['level', 'flow'])
    expect(stations.find((station) => station.id === 2)?.quantities).toEqual([])
  })

  /** The fixture's only line holds 56.148. */
  it('reads the NGF datum off the recorded altimetric history', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(stations.find((station) => station.id === 84)?.ngfDatum).toBe(56.148)
  })

  /** The list's `ngfCote` is not where the datum is read. */
  it('gives no datum to a station whose detail holds no altimetric history', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(stations.find((station) => station.id === 2)?.ngfDatum).toBeNull()
  })

  /** Station 2 stores its level in metres NGF, which its detail does not say. */
  it('reads what a level is measured from off the reference table', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(stations.find((station) => station.id === 2)?.levelDatum).toBe('ngf')
    expect(stations.find((station) => station.id === 84)?.levelDatum).toBe('gauge')
  })

  it('records a detail that failed and keeps the other stations', async () => {
    const options = collect({
      ...stationReferentialRoutes(),
      '/hydrologicalStation/84': { status: 500 },
    })
    const stations = await fetchStations(options)

    expect(stations).toHaveLength(3)
    // Unknown rather than empty: nothing says the station measures nothing.
    expect(stations.find((station) => station.id === 84)?.quantities).toBeNull()
    expect(options.collector.seal().failures).toMatchObject([
      { subject: 'station 84 detail', status: 500 },
    ])
  })
})

describe('the rain gauge referential', () => {
  it('passes degrees through and reprojects only what is in Lambert 93', async () => {
    const options = collect({ '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } })
    const gauges = await fetchRainGauges(options)

    expect(gauges.find((gauge) => gauge.id === 4)?.position).toEqual({
      lon: 2.2955,
      lat: 43.215333,
    })
    const quillane = gauges.find((gauge) => gauge.id === 737)
    expect(quillane?.position?.lon).toBeCloseTo(2.12, 2)
    expect(quillane?.position?.lat).toBeCloseTo(42.53, 2)
  })

  it('keeps a gauge without coordinates when no extent is given', async () => {
    const options = collect({ '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } })
    const gauges = await fetchRainGauges(options)

    expect(gauges.find((gauge) => gauge.id === 744)?.position).toBeNull()
  })

  it('reads rain, not the temperature the same typeId means elsewhere', async () => {
    const options = collect({ '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } })
    const gauges = await fetchRainGauges(options)

    expect(gauges.find((gauge) => gauge.id === 4)?.quantities).toEqual(['rainfall'])
  })

  /** Gauge 5 is a SAFRAN cell, gauge 693 an ERA5 one. */
  it('leaves out the gauges Aquasys simulates, before any detail call, and says so', async () => {
    const options = collect({ '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } })
    const gauges = await fetchRainGauges(options)

    expect(gauges.map((gauge) => gauge.id)).toEqual([4, 737, 744])
    expect(options.fetch.calls.some((call) => /\/pluviometer\/(5|693)$/.test(call))).toBe(false)
    expect(options.collector.seal().fallbacks).toContainEqual({
      subject: '2 rain gauge(s)',
      rule: 'simulated, recognised by a SAFRAN_ or X…Y… code pending a stated rule',
      applied: 'rain gauges left out',
    })
  })
})

describe('the networks a station belongs to', () => {
  it('reads every link of the fleet in one call', async () => {
    const fetch = fetchStub({
      '/hydrologicalStation/networkLink': { json: fixture('aquasys/network-links.json') },
    })
    const client = new AquasysClient({ config: CONFIG, fetch, minIntervalMs: 0 })
    const links = z.array(rawNetworkLinkSchema).parse(await client.networkLinks())

    expect(links.filter((link) => link.idStation === 3).map((link) => link.idNetwork)).toEqual([
      5, 4,
    ])
    expect(fetch.calls).toEqual(['https://api.test/api/hydrologicalStation/networkLink'])
  })
})

/**
 * Aquasys has no spatial filter, so the whole list is loaded either way — but
 * everything after the filter costs one request per source, and that is what
 * the extent is there to spare.
 */
describe('the extent of a replay', () => {
  /**
   * The Berre and the Corbières: holds station 84 at 2.835/43.039, and excludes
   * the Aude at Sallèles (2.946/43.254), the Orbieu (2.539/43.015) and Matemale
   * (2.114/42.581).
   */
  const CORBIERES: BoundingBox = { minLon: 2.75, minLat: 42.95, maxLon: 2.9, maxLat: 43.1 }

  it('keeps only the sources inside it', async () => {
    const options = collect(stationReferentialRoutes(), CORBIERES)
    const stations = await fetchStations(options)

    expect(stations.map((station) => station.id)).toEqual([84])
  })

  it('spares the detail call for every source it excludes', async () => {
    const options = collect(stationReferentialRoutes(), CORBIERES)
    await fetchStations(options)

    expect(options.fetch.calls).toHaveLength(3)
  })

  it('keeps the whole fleet when none is given', async () => {
    const options = collect({ '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } })
    const gauges = await fetchRainGauges(options)

    expect(gauges).toHaveLength(3)
  })
})

describe('a source that cannot be placed', () => {
  // The simulated gauges of the same listing are reported too, and are not this.
  const positionsOf = (fallbacks: Fallback[]) =>
    fallbacks.filter((one) => one.rule === 'no usable coordinates in the referential')

  it('says its position is missing when no extent is in play', async () => {
    const options = collect({ '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } })
    await fetchRainGauges(options)

    expect(positionsOf(options.collector.seal().fallbacks)).toEqual([
      {
        subject: 'rain gauge 744',
        rule: 'no usable coordinates in the referential',
        applied: 'position omitted',
      },
    ])
  })

  /** It does not merely lose its position, it leaves the collection. */
  it('says it was dropped when an extent decides the fleet', async () => {
    const options = collect(
      { '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } },
      {
        minLon: -180,
        minLat: -90,
        maxLon: 180,
        maxLat: 90,
      },
    )
    const gauges = await fetchRainGauges(options)

    expect(gauges.map((gauge) => gauge.id)).not.toContain(744)
    expect(positionsOf(options.collector.seal().fallbacks)).toEqual([
      {
        subject: 'rain gauge 744',
        rule: 'no usable coordinates in the referential',
        applied: 'source dropped, an extent was given',
      },
    ])
  })
})

describe('the calls to Aquasys', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('are spaced by default, as a production service asks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    const sent: number[] = []
    const client = new AquasysClient({
      config: CONFIG,
      fetch: async () => {
        sent.push(Date.now())
        return Response.json([])
      },
    })

    const both = Promise.all([client.networkLinks(), client.networkLinks()])
    await vi.runAllTimersAsync()
    await both

    expect(sent).toHaveLength(2)
    expect(sent[1]! - sent[0]!).toBeGreaterThanOrEqual(500)
  })
})
