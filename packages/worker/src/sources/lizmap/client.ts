import {
  SourceError,
  featureCollectionSchema,
  type Feature,
  type FeatureCollection,
  type LizmapConfig,
} from '@smmarchives/shared'

import { HttpClient, type Fetch, withQuery } from '../../http.ts'

/** The crisis project this application reads. Remote identifiers, not configuration. */
export const REPOSITORY = 'crise'
export const PROJECT = 'gestion_crise'

/**
 * The Lizmap this reads is a crisis tool in production: requests stay spaced,
 * read-only, and low in volume.
 */
const DEFAULT_MIN_INTERVAL_MS = 500

export type LizmapClientOptions = {
  config: LizmapConfig
  fetch?: Fetch | undefined
  minIntervalMs?: number
}

/**
 * Addresses the SMMAR crisis Lizmap.
 *
 * Two access rules, and they differ. The OGC proxy answers `Forbidden` until
 * the project view has been opened and a `PHPSESSID` obtained — an anonymous
 * session, so an application servitude rather than access control. `getMedia`
 * needs neither.
 *
 * Bootstrapping a session is a workaround, and it has been reported as such:
 * the connector depends on an application cookie rather than a stable access
 * point, which a configuration change on the SMMAR side would break. A direct
 * WFS service, or a refreshed static export, has been asked for.
 */
export class LizmapClient {
  readonly #http: HttpClient
  readonly #baseUrl: string
  #cookie: string | undefined

  constructor(options: LizmapClientOptions) {
    this.#baseUrl = options.config.baseUrl
    this.#http = new HttpClient({
      fetch: options.fetch,
      minIntervalMs: options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    })
  }

  /**
   * Reads a layer as GeoJSON, opening a session first and once more if the one
   * in hand has expired, and repairing the response before returning it.
   *
   * Layer names come from the WMS `GetCapabilities`, never the WFS one, which
   * declares ten layers and lists neither `webcam` nor `ouvrage_hydraulique`
   * although both answer a `GetFeature` perfectly.
   */
  async getFeature(layer: string): Promise<FeatureCollection> {
    await this.#openSession()
    let body = await this.#requestFeature(layer)

    if (isForbidden(body)) {
      this.#cookie = undefined
      await this.#openSession()
      body = await this.#requestFeature(layer)
    }
    return trimStrings(parseFeature(layer, body, this.#serviceUrl(layer)))
  }

  /** Files attached to the project: image lists, popup scripts. No session needed. */
  async getMedia(path: string): Promise<unknown> {
    const url = withQuery(`${this.#baseUrl}/index.php/view/media/getMedia`, {
      repository: REPOSITORY,
      project: PROJECT,
      path,
    })
    return this.#http.json(url)
  }

  async #openSession(): Promise<void> {
    if (this.#cookie !== undefined) return

    const url = withQuery(`${this.#baseUrl}/index.php/view/map`, {
      repository: REPOSITORY,
      project: PROJECT,
    })
    const response = await this.#http.response(url)
    const cookie = response.headers
      .getSetCookie()
      .map((entry) => entry.split(';', 1)[0] ?? '')
      .find((entry) => entry.startsWith('PHPSESSID='))

    if (cookie === undefined) {
      throw new SourceError('Opening the project set no PHPSESSID', { url })
    }
    this.#cookie = cookie
  }

  #requestFeature(layer: string): Promise<string> {
    return this.#http.text(this.#serviceUrl(layer), {
      headers: this.#cookie === undefined ? {} : { Cookie: this.#cookie },
    })
  }

  #serviceUrl(layer: string): string {
    return withQuery(`${this.#baseUrl}/index.php/lizmap/service/`, {
      repository: REPOSITORY,
      project: PROJECT,
      SERVICE: 'WFS',
      VERSION: '1.3.0',
      REQUEST: 'GetFeature',
      OUTPUTFORMAT: 'geojson',
      TYPENAME: layer,
    })
  }
}

/**
 * A refused or rendering-only layer comes back as an XML `ServiceException`
 * under HTTP 200, so the status alone never says whether the read worked.
 */
function isForbidden(body: string): boolean {
  return body.includes('ServiceException') && body.includes('Forbidden')
}

function parseFeature(layer: string, body: string, url: string): FeatureCollection {
  if (!body.trimStart().startsWith('{')) {
    throw new SourceError(`Layer ${layer} did not return GeoJSON`, { url, body })
  }
  try {
    return featureCollectionSchema.parse(JSON.parse(body))
  } catch (cause) {
    throw new SourceError(`Layer ${layer} returned unusable GeoJSON`, { url, body, cause })
  }
}

/**
 * Trims every property value.
 *
 * Six values of the `webcam` layer end with a newline, on `url` and `commune`,
 * and the defect is at the source. Repairing it here rather than in each
 * consumer is what keeps the third consumer from re-introducing a join that
 * fails on `"Villegailhenc\n"`.
 */
function trimStrings(collection: FeatureCollection): FeatureCollection {
  return { ...collection, features: collection.features.map(trimFeature) }
}

function trimFeature(feature: Feature): Feature {
  if (feature.properties === null) return feature

  return {
    ...feature,
    properties: Object.fromEntries(
      Object.entries(feature.properties).map(([key, value]) => [
        key,
        typeof value === 'string' ? value.trim() : value,
      ]),
    ),
  }
}
