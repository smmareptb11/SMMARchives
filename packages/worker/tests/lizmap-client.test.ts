import { describe, expect, it } from 'vitest'

import { LizmapClient } from '../src/sources/lizmap/client.ts'
import { fetchStub, fixture, fixtureText, type StubbedResponse } from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://crise.test' }

function clientFor(response: StubbedResponse) {
  const fetch = fetchStub({ TYPENAME: response })
  return { client: new LizmapClient({ config: CONFIG, fetch, minIntervalMs: 0 }), fetch }
}

describe('reading a layer', () => {
  it('asks for GeoJSON and does not reproject what comes back', async () => {
    const { client, fetch } = clientFor({ json: fixture('lizmap/webcam.json') })

    const geojson = await client.getFeature('webcam')

    expect(fetch.calls[0]).toContain('OUTPUTFORMAT=geojson')
    expect(geojson.features[0]).toHaveProperty('geometry')
  })
})

describe('a layer that refuses the read', () => {
  it('is a failure', async () => {
    const { client } = clientFor({ text: fixtureText('lizmap/forbidden.xml') })

    await expect(client.getFeature('webcam')).rejects.toThrow(/did not return GeoJSON/)
  })
})

describe('a layer published for rendering only', () => {
  /**
   * Such a layer answers a `GetFeature` with an XML `ServiceException` under
   * HTTP 200, so the status never says on its own whether the read worked.
   */
  it('is a failure rather than an empty collection', async () => {
    const { client } = clientFor({
      text: '<ServiceException code="RequestNotWellFormed">…</ServiceException>',
    })

    await expect(client.getFeature('limnimetre')).rejects.toThrow(/did not return GeoJSON/)
  })
})
