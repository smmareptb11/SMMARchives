import type { AquasysConfig, SourceFamily } from '@smmarchives/shared'

import { HttpClient, type Fetch, withQuery } from '../../http.ts'

export type AquasysClientOptions = {
  config: AquasysConfig
  fetch?: Fetch | undefined
}

export type MeasureRequest = {
  sourceId: number
  dataType: number
  startEpochMilliseconds: number
  endEpochMilliseconds: number
}

/** The endpoints of one family, so callers never re-derive the pairing. */
type FamilyRoutes = {
  list: string
  detail: (id: number) => string
  thresholds: (id: number) => string
  measures: string
}

/**
 * Addresses the Aquasys (Myliaq) API.
 *
 * Two facts shape it. Lists take no parameter and come back whole — `limit`
 * returns a non-deterministic slice with no offset to go with it, and the
 * identifier space is sparse, so nothing is ever enumerated by range. And the
 * measure endpoints need their parameters in the query string *and* in the JSON
 * body: query-only yields an opaque HTTP 500, and a date sent as a string
 * rather than an int64 yields an empty HTTP 400.
 */
export class AquasysClient {
  readonly #http: HttpClient
  readonly #routes: Record<SourceFamily, FamilyRoutes>

  constructor(options: AquasysClientOptions) {
    const base = options.config.baseUrl
    this.#http = new HttpClient({
      fetch: options.fetch,
      headers: { Authorization: `Bearer ${options.config.token}` },
    })
    this.#routes = {
      hydro: {
        list: `${base}/hydrologicalStation/`,
        detail: (id) => `${base}/hydrologicalStation/${id}`,
        thresholds: (id) => `${base}/hydrologicalStation/${id}/threshold`,
        measures: `${base}/hydrologicalStation/chronic/measures`,
      },
      'rain-gauge': {
        list: `${base}/pluviometer/`,
        detail: (id) => `${base}/pluviometer/${id}`,
        thresholds: (id) => `${base}/pluviometer/${id}/threshold`,
        measures: `${base}/pluviometer/chartMeasures`,
      },
    }
  }

  list(family: SourceFamily): Promise<unknown> {
    return this.#http.json(this.#routes[family].list)
  }

  detail(family: SourceFamily, id: number): Promise<unknown> {
    return this.#http.json(this.#routes[family].detail(id))
  }

  thresholds(family: SourceFamily, id: number): Promise<unknown> {
    return this.#http.json(this.#routes[family].thresholds(id))
  }

  /**
   * `groupFunc` is deliberately never sent: only `MAX` in capitals aggregates,
   * every other value returns the raw series in HTTP 200 without a warning.
   * Aggregation belongs to the application.
   */
  measures(family: SourceFamily, request: MeasureRequest): Promise<unknown> {
    const body = {
      stationId: request.sourceId,
      dataType: request.dataType,
      startDate: request.startEpochMilliseconds,
      endDate: request.endEpochMilliseconds,
    }
    return this.#http.json(withQuery(this.#routes[family].measures, body), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
}
