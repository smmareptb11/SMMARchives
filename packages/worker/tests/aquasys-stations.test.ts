import { ReportCollector, type BoundingBox } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AquasysClient } from '../src/sources/aquasys/client.ts'
import { rawNetworkLinkSchema } from '../src/sources/aquasys/raw.ts'
import { fetchRainGauges, fetchStations } from '../src/sources/aquasys/stations.ts'
import { fetchStub, fixture, stationReferentialRoutes } from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://api.test/api', token: 'jeton', timeZone: 'UTC' }

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
  const client = new AquasysClient({ config: CONFIG, fetch })
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
    expect(options.collector.seal().fallbacks).toEqual([
      {
        subject: 'station 84',
        rule: 'on both structure and watercourse networks',
        applied: 'station dropped',
      },
    ])
  })

  it('leaves out an out-of-scope station before any detail call', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(stations.map((station) => station.id)).toEqual([84, 2, 152])
    expect(options.fetch.calls.some((call) => call.includes('/hydrologicalStation/24'))).toBe(false)
  })

  it('reads what a station measures from its measurement points', async () => {
    const options = collect(stationReferentialRoutes())
    const stations = await fetchStations(options)

    expect(stations.find((station) => station.id === 84)?.quantities).toEqual(['level', 'flow'])
    expect(stations.find((station) => station.id === 2)?.quantities).toEqual([])
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
})

describe('the networks a station belongs to', () => {
  it('reads every link of the fleet in one call', async () => {
    const fetch = fetchStub({
      '/hydrologicalStation/networkLink': { json: fixture('aquasys/network-links.json') },
    })
    const client = new AquasysClient({ config: CONFIG, fetch })
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
  it('says its position is missing when no extent is in play', async () => {
    const options = collect({ '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } })
    await fetchRainGauges(options)

    expect(options.collector.seal().fallbacks).toEqual([
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
    expect(options.collector.seal().fallbacks).toEqual([
      {
        subject: 'rain gauge 744',
        rule: 'no usable coordinates in the referential',
        applied: 'source dropped, an extent was given',
      },
    ])
  })
})
