import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RADAR_RAINFALL_EXTENT,
  apiConfig,
  aquasysConfig,
  mediaConfig,
  optionalRadarRainfallConfig,
  radarRainfallConfig,
} from '../src/config.ts'
import { ConfigurationError } from '../src/errors.ts'

describe('the volume holding the frozen media', () => {
  it('names itself when it is missing, rather than writing into the working directory', () => {
    expect(() => mediaConfig({})).toThrow(/MEDIA_PATH/)
  })

  it('is taken as given, since the operator chooses the volume', () => {
    expect(mediaConfig({ MEDIA_PATH: '/srv/smmarchives/media' }).root).toBe(
      '/srv/smmarchives/media',
    )
  })
})

describe("the API's listening port", () => {
  it('falls back on 3000, which is what the documentation announces', () => {
    expect(apiConfig({}).port).toBe(3000)
  })

  it('is read as a number', () => {
    expect(apiConfig({ API_PORT: '8080' }).port).toBe(8080)
  })

  it('refuses what is not a port, rather than binding an arbitrary one', () => {
    expect(() => apiConfig({ API_PORT: 'abc' })).toThrow(ConfigurationError)
    expect(() => apiConfig({ API_PORT: '0' })).toThrow(/API_PORT/)
    expect(() => apiConfig({ API_PORT: '70000' })).toThrow(/API_PORT/)
    expect(() => apiConfig({ API_PORT: '80.5' })).toThrow(/API_PORT/)
  })
})

describe('a missing variable', () => {
  it('names itself rather than failing later on an undefined url', () => {
    expect(() => aquasysConfig({ ACYCLIQ_TOKEN: 'x' })).toThrow(ConfigurationError)
    expect(() => aquasysConfig({ ACYCLIQ_TOKEN: 'x' })).toThrow(/ACYCLIQ_API_URL/)
  })

  it('treats an empty value as missing', () => {
    expect(() => radarRainfallConfig({ RADAR_RAINFALL_PATH: '   ' })).toThrow(/RADAR_RAINFALL_PATH/)
  })
})

/**
 * The delivery directory is the one source that arrives in batches rather than
 * over the wire: it does not exist until Predict has delivered. A caller that
 * did not name this source gets nothing back and carries on without the lane.
 */
describe('a radar root nobody asked for by name', () => {
  it('is nothing to read, rather than a configuration error', () => {
    expect(optionalRadarRainfallConfig({})).toBeUndefined()
    expect(optionalRadarRainfallConfig({ RADAR_RAINFALL_PATH: '   ' })).toBeUndefined()
  })

  it('reads as usual once the variable holds a root', () => {
    expect(optionalRadarRainfallConfig({ RADAR_RAINFALL_PATH: '/data' })?.root).toBe('/data')
  })

  it('takes an overriding root even with the variable unset', () => {
    expect(optionalRadarRainfallConfig({}, { root: '/livraisons' })?.root).toBe('/livraisons')
  })

  it('still refuses an extent it cannot read, which no absence excuses', () => {
    expect(() =>
      optionalRadarRainfallConfig({ RADAR_RAINFALL_PATH: '/data', RADAR_RAINFALL_BBOX: '1,2,3' }),
    ).toThrow(/RADAR_RAINFALL_BBOX/)
  })
})

describe('the Aquasys time reference', () => {
  const base = { ACYCLIQ_API_URL: 'https://aquasys.test/api/', ACYCLIQ_TOKEN: 'x' }

  it('defaults to UTC rather than to the host time zone', () => {
    expect(aquasysConfig(base).timeZone).toBe('UTC')
  })

  it('accepts the local reference the storage may actually use', () => {
    expect(aquasysConfig({ ...base, AQUASYS_TIME_ZONE: 'Europe/Paris' }).timeZone).toBe(
      'Europe/Paris',
    )
  })

  it('refuses a zone that is not IANA', () => {
    expect(() => aquasysConfig({ ...base, AQUASYS_TIME_ZONE: 'Paris' })).toThrow(/IANA/)
  })

  it('drops the trailing slash so paths do not double up', () => {
    expect(aquasysConfig(base).baseUrl).toBe('https://aquasys.test/api')
  })
})

describe('the radar rainfall extent', () => {
  it('falls back on the documented extent when unset', () => {
    expect(radarRainfallConfig({ RADAR_RAINFALL_PATH: '/data' }).extent).toEqual(
      DEFAULT_RADAR_RAINFALL_EXTENT,
    )
  })

  it('is overridable, since the documented value is not authoritative', () => {
    const config = radarRainfallConfig({
      RADAR_RAINFALL_PATH: '/data',
      RADAR_RAINFALL_BBOX: '1.5, 42.4, 3.3, 43.5',
    })
    expect(config.extent).toEqual({ minLon: 1.5, minLat: 42.4, maxLon: 3.3, maxLat: 43.5 })
  })

  it('refuses a malformed extent rather than cropping the wrong area', () => {
    expect(() =>
      radarRainfallConfig({ RADAR_RAINFALL_PATH: '/data', RADAR_RAINFALL_BBOX: '1.5,42.4,3.3' }),
    ).toThrow(/four numbers/)
  })

  it('refuses an inverted extent', () => {
    expect(() =>
      radarRainfallConfig({
        RADAR_RAINFALL_PATH: '/data',
        RADAR_RAINFALL_BBOX: '3.3,42.4,1.5,43.5',
      }),
    ).toThrow(/minimum past its maximum/)
  })
})

/**
 * An extent nobody could mean used to pass: `1000,2000,3000,4000` was accepted,
 * matched no source, and returned an empty collection indistinguishable from an
 * extent that legitimately holds nothing. The bounds now live on the type, so
 * both the `--bbox` flag and this variable inherit them.
 */
describe('an extent that is not a place on Earth', () => {
  it('is refused rather than silently matching nothing', () => {
    expect(() =>
      radarRainfallConfig({
        RADAR_RAINFALL_PATH: '/data',
        RADAR_RAINFALL_BBOX: '1000,2000,3000,4000',
      }),
    ).toThrow(ConfigurationError)
  })

  it('is refused one coordinate at a time', () => {
    const bbox = (value: string) => () =>
      radarRainfallConfig({ RADAR_RAINFALL_PATH: '/data', RADAR_RAINFALL_BBOX: value })

    expect(bbox('-181,42,3,43')).toThrow(/RADAR_RAINFALL_BBOX/)
    expect(bbox('1.5,42,3,91')).toThrow(/RADAR_RAINFALL_BBOX/)
    expect(bbox('1.5,42.4,3.3,43.5')).not.toThrow()
  })
})
