import type { TimeWindow } from '@smmarchives/shared/clock.ts'
import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import type { Measure } from '@smmarchives/shared/contracts/measure.ts'
import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { ApiError, problemOf } from './problems.ts'

/**
 * Every call the interface makes, and no other.
 *
 * Relative paths on purpose: one origin serves the bundle and forwards these
 * to the API, in development through Vite and in production through the
 * reverse proxy. Nothing here knows where the API lives.
 */
async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw new ApiError(await problemOf(response))
  return (await response.json()) as T
}

export type Creation = {
  label: string | null
  extent: BoundingBox | null
  period: TimeWindow
}

export const api = {
  health: () => ask<{ status: string }>('/health'),

  listReplays: () => ask<ReplayManifest[]>('/replays'),

  manifestOf: (id: string) => ask<ReplayManifest>(`/replays/${id}`),

  createReplay: (creation: Creation) =>
    ask<ReplayManifest>('/replays', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(creation),
    }),

  datasetOf: <T>(
    id: string,
    name: string,
    filter: Record<string, string> = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams(filter).toString()
    const path = `/replays/${id}/${name}${query === '' ? '' : `?${query}`}`
    return ask<T>(path, signal === undefined ? undefined : { signal })
  },

  /** The measures of one source and one quantity, over the replay's period. */
  measuresOf: (id: string, sourceId: number, quantity: Quantity, signal?: AbortSignal) =>
    api.datasetOf<Measure[]>(id, 'measures', { source: String(sourceId), quantity }, signal),

  /** Where a frozen medium is served from, for an `img` to point at. */
  mediaUrl: (id: string, path: string) => `/replays/${id}/media/${path}`,
}
