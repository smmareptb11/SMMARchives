import { ReportCollector, exitCodeFor } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { LizmapClient } from '../src/sources/lizmap/client.ts'
import { fetchReferenceLayers } from '../src/sources/lizmap/layers.ts'
import { fetchStub, fixture, fixtureText, type StubbedRoute } from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://crise.test' }

const SESSION = { text: '<html/>', headers: { 'Set-Cookie': 'PHPSESSID=abc; path=/' } }
const OUVRAGES = { json: fixture('lizmap/ouvrage_hydraulique.json') }
const FORBIDDEN = { text: fixtureText('lizmap/forbidden.xml') }

function read(layers: string[], routes: Record<string, StubbedRoute>) {
  const collector = new ReportCollector('fetch:lizmap:layers', {})
  const fetch = fetchStub({ '/index.php/view/map': SESSION, ...routes })
  const client = new LizmapClient({ config: CONFIG, fetch, minIntervalMs: 0 })
  return fetchReferenceLayers({ client, collector, layers }).then((data) => ({
    data,
    fetch,
    report: collector.seal(),
  }))
}

describe('reading a reference layer', () => {
  it('opens a session before touching the OGC service', async () => {
    const { fetch } = await read(['ouvrage_hydraulique'], { TYPENAME: OUVRAGES })

    expect(fetch.calls[0]).toContain('/index.php/view/map')
    expect(fetch.calls[1]).toContain('TYPENAME=ouvrage_hydraulique')
  })

  it('opens it once for several layers', async () => {
    const { fetch } = await read(['ouvrage_hydraulique', 'perimetre_smmar'], {
      TYPENAME: OUVRAGES,
    })

    expect(fetch.calls.filter((call) => call.includes('/index.php/view/map'))).toHaveLength(1)
  })

  it('asks for GeoJSON and does not reproject what comes back', async () => {
    const { data, fetch } = await read(['ouvrage_hydraulique'], { TYPENAME: OUVRAGES })

    expect(fetch.calls[1]).toContain('OUTPUTFORMAT=geojson')
    expect(data[0]?.featureCount).toBe(2)
    expect(data[0]?.geojson.features[0]).toHaveProperty('geometry')
  })
})

describe('an expired session', () => {
  it('is renewed once, and the read succeeds', async () => {
    const { data, fetch } = await read(['ouvrage_hydraulique'], {
      TYPENAME: [FORBIDDEN, OUVRAGES],
    })

    expect(data[0]?.featureCount).toBe(2)
    expect(fetch.calls.filter((call) => call.includes('/index.php/view/map'))).toHaveLength(2)
  })

  it('is a failure when renewal does not help', async () => {
    const { data, report } = await read(['ouvrage_hydraulique'], {
      TYPENAME: FORBIDDEN,
    })

    expect(data).toEqual([])
    expect(report.failures[0]?.message).toMatch(/did not return GeoJSON/)
    expect(exitCodeFor(report)).toBe(2)
  })
})

describe('a layer published for rendering only', () => {
  /**
   * Such a layer answers a `GetFeature` with an XML `ServiceException` under
   * HTTP 200, so the status never says on its own whether the read worked.
   */
  it('is reported rather than read as an empty collection', async () => {
    const { data, report } = await read(['limnimetre'], {
      TYPENAME: {
        text: '<ServiceException code="RequestNotWellFormed">…</ServiceException>',
      },
    })

    expect(data).toEqual([])
    expect(report.failures).toMatchObject([{ subject: 'layer limnimetre' }])
  })
})

describe('the strings a layer carries', () => {
  it('are trimmed, because the defect is at the source', async () => {
    const { data } = await read(['webcam'], { TYPENAME: { json: fixture('lizmap/webcam.json') } })

    const properties = data[0]?.geojson.features.map((feature) => feature.properties)
    expect(properties?.some((one) => String(one?.url).endsWith('\n'))).toBe(false)
    expect(properties?.find((one) => one?.code === '550')?.commune).toBe('Villegailhenc')
  })
})
