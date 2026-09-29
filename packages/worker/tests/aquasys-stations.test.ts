import { ReportCollector, type BoundingBox } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { AquasysClient } from '../src/sources/aquasys/client.ts'
import { fetchRainGauges, fetchStations } from '../src/sources/aquasys/stations.ts'
import { listSourceIds, type SourceScope } from '../src/sources/aquasys/source-ids.ts'
import { fetchStub, fixture } from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://api.test/api', token: 'jeton', timeZone: 'UTC' }

function collect(
  routes: Parameters<typeof fetchStub>[0],
  withDetails = false,
  extent: BoundingBox | undefined = undefined,
) {
  const collector = new ReportCollector('fetch:aquasys:stations', {})
  const fetch = fetchStub(routes)
  const client = new AquasysClient({ config: CONFIG, fetch })
  return { client, collector, fetch, withDetails, extent }
}

describe('the hydrological station referential', () => {
  it('reprojects, types, and keeps no referential date', async () => {
    const options = collect({ '/hydrologicalStation/': { json: fixture('aquasys/stations.json') } })
    const stations = await fetchStations(options)

    expect(stations).toHaveLength(3)
    const berre = stations.find((station) => station.id === 84)
    expect(berre).toMatchObject({
      id: 84,
      code: 'Y082401001',
      category: 'watercourse',
      categoryIsFallback: false,
    })
    expect(berre?.position?.lon).toBeCloseTo(2.83, 2)
    expect(berre?.position?.lat).toBeCloseTo(43.04, 2)
    expect(berre).not.toHaveProperty('creationDate')
    expect(berre).not.toHaveProperty('closeDate')
  })

  it('never lets a nominative login through', async () => {
    const options = collect({ '/hydrologicalStation/': { json: fixture('aquasys/stations.json') } })
    const stations = await fetchStations(options)

    expect(JSON.stringify(stations)).not.toContain('agent-a')
    expect(JSON.stringify(stations)).not.toContain('updateLogin')
  })

  it('signals the station it could not type', async () => {
    const options = collect({ '/hydrologicalStation/': { json: fixture('aquasys/stations.json') } })
    await fetchStations(options)

    expect(options.collector.seal().fallbacks).toEqual([
      {
        subject: 'station 152',
        rule: 'station appears in no Lizmap layer',
        applied: 'watercourse',
      },
    ])
  })

  it('leaves quantities unknown rather than empty when details are skipped', async () => {
    const options = collect({ '/hydrologicalStation/': { json: fixture('aquasys/stations.json') } })
    const stations = await fetchStations(options)

    expect(stations.every((station) => station.quantities === null)).toBe(true)
    expect(options.fetch.calls).toHaveLength(1)
  })

  it('leaves out an out-of-scope station before any detail call', async () => {
    const options = collect(
      {
        '/hydrologicalStation/84': { json: fixture('aquasys/station-84-detail.json') },
        '/hydrologicalStation/': { json: fixture('aquasys/stations.json') },
        '/hydrologicalStation/2': { json: { id: 2, link_pointPrels: [] } },
        '/hydrologicalStation/152': { json: { id: 152 } },
      },
      true,
    )
    const stations = await fetchStations(options)

    expect(stations.map((station) => station.id)).toEqual([84, 2, 152])
    expect(options.fetch.calls.some((call) => call.includes('/hydrologicalStation/24'))).toBe(false)
  })

  it('reads what a station measures from its measurement points', async () => {
    const options = collect(
      {
        '/hydrologicalStation/84': { json: fixture('aquasys/station-84-detail.json') },
        '/hydrologicalStation/': { json: fixture('aquasys/stations.json') },
        '/hydrologicalStation/2': { json: { id: 2, link_pointPrels: [] } },
        '/hydrologicalStation/152': { json: { id: 152 } },
      },
      true,
    )
    const stations = await fetchStations(options)

    expect(stations.find((station) => station.id === 84)?.quantities).toEqual(['level', 'flow'])
    expect(stations.find((station) => station.id === 2)?.quantities).toEqual([])
  })

  it('records a detail that failed and keeps the other stations', async () => {
    const options = collect(
      {
        '/hydrologicalStation/84': { status: 500 },
        '/hydrologicalStation/': { json: fixture('aquasys/stations.json') },
        '/hydrologicalStation/2': { json: { id: 2, link_pointPrels: [] } },
        '/hydrologicalStation/152': { json: { id: 152 } },
      },
      true,
    )
    const stations = await fetchStations(options)

    expect(stations).toHaveLength(3)
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
    const options = collect(
      {
        '/pluviometer/4': { json: fixture('aquasys/rain-gauge-4-detail.json') },
        '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') },
        '/pluviometer/737': { json: { id: 737 } },
        '/pluviometer/744': { json: { id: 744 } },
      },
      true,
    )
    const gauges = await fetchRainGauges(options)

    expect(gauges.find((gauge) => gauge.id === 4)?.quantities).toEqual(['rainfall'])
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
    const options = collect(
      { '/hydrologicalStation/': { json: fixture('aquasys/stations.json') } },
      false,
      CORBIERES,
    )
    const stations = await fetchStations(options)

    expect(stations.map((station) => station.id)).toEqual([84])
  })

  it('spares the detail call for every source it excludes', async () => {
    const options = collect(
      {
        '/hydrologicalStation/84': { json: fixture('aquasys/station-84-detail.json') },
        '/hydrologicalStation/': { json: fixture('aquasys/stations.json') },
      },
      true,
      CORBIERES,
    )
    await fetchStations(options)

    expect(options.fetch.calls).toHaveLength(2)
  })

  it('keeps the whole fleet when none is given', async () => {
    const options = collect({ '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') } })
    const gauges = await fetchRainGauges(options)

    expect(gauges).toHaveLength(3)
  })
})

/**
 * A scope is one choice, not two flags that could disagree. The shape that let
 * them disagree once produced a run returning a station 60 km outside the
 * extent its own report announced; the contradiction is now unrepresentable,
 * and refused at the boundary instead — see `script-contract.test.ts`.
 */
describe('the scope a run works on', () => {
  const CORBIERES: BoundingBox = { minLon: 2.75, minLat: 42.95, maxLon: 2.9, maxLat: 43.1 }

  function select(scope: SourceScope) {
    const collector = new ReportCollector('probe', {})
    const fetch = fetchStub({ '/hydrologicalStation/': { json: fixture('aquasys/stations.json') } })
    return listSourceIds({
      client: new AquasysClient({ config: CONFIG, fetch }),
      collector,
      family: 'hydro',
      scope,
    })
  }

  it('takes the explicit list without reading the referential', async () => {
    await expect(select({ kind: 'ids', ids: [152, 24] })).resolves.toEqual([152, 24])
  })

  it('keeps what the extent holds', async () => {
    await expect(select({ kind: 'extent', extent: CORBIERES })).resolves.toEqual([84])
  })

  it('takes the whole family when neither is chosen', async () => {
    await expect(select({ kind: 'whole-family' })).resolves.toEqual([84, 2, 152])
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
      false,
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
