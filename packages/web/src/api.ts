import type { TimeWindow } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import type { Measure } from '@smmarchives/shared/contracts/measure.ts'
import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'
import type { ReplayAbout, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import type { Report } from './events/draft.ts'
import { ApiError, problemOf } from './problems.ts'

/**
 * Every call the interface makes, and no other. Relative paths on purpose: one
 * origin serves the bundle and forwards these to the API, through Vite or the
 * reverse proxy.
 */
async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw await refusalOf(response)
  return (await response.json()) as T
}

/** For a call answered 204, which has no body for `ask` to read. */
async function send(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, init)
  if (!response.ok) throw await refusalOf(response)
}

/**
 * Says `lost` when the API answers that nobody is signed in: the interface asks
 * about the session once, and learns it expired from the first write refused.
 */
export const sessionLost = new EventTarget()

async function refusalOf(response: Response): Promise<ApiError> {
  if (response.status === 401) sessionLost.dispatchEvent(new Event('lost'))
  return new ApiError(await problemOf(response))
}

export type Creation = {
  label: string | null
  extent: BoundingBox | null
  /** The basin union the extent was framed on, absent when none names it. */
  territory?: string
  period: TimeWindow
} & ReplayAbout

export const api = {
  health: () => ask<{ status: string }>('/health'),

  /** Whether this browser holds the administrator's session. */
  session: () => ask<{ authenticated: boolean }>('/session'),

  signIn: (password: string) =>
    send('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    }),

  signOut: () => send('/session', { method: 'DELETE' }),

  listReplays: () => ask<ReplayManifest[]>('/replays'),

  manifestOf: (id: string) => ask<ReplayManifest>(`/replays/${id}`),

  /** Removes its rows, then its media; the API refuses one being built. */
  removeReplay: (id: string) => send(`/replays/${id}`, { method: 'DELETE' }),

  /** Opens it to everyone; the API refuses a replay that is not complete. */
  publish: (id: string) => ask<ReplayManifest>(`/replays/${id}/publication`, { method: 'PUT' }),

  unpublish: (id: string) =>
    ask<ReplayManifest>(`/replays/${id}/publication`, { method: 'DELETE' }),

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

  /** The measures of one station and one quantity, over the replay's period. */
  stationMeasuresOf: (id: string, sourceId: number, quantity: Quantity, signal?: AbortSignal) =>
    api.datasetOf<Measure[]>(
      id,
      'measures',
      { family: 'hydro', source: String(sourceId), quantity },
      signal,
    ),

  /**
   * Adds what an agent reported. JSON when there is no photo, a form when there
   * are: the event first, which the API judges before writing a single photo.
   */
  reportEvent: (id: string, report: Report, photos: readonly File[]) =>
    ask<ReplayEvent>(`/replays/${id}/events`, { method: 'POST', ...bodyOf(report, photos) }),

  /**
   * Replaces what an agent reported, whole: the photos it keeps by their paths,
   * the new ones as files, after them.
   */
  amendEvent: (
    id: string,
    eventId: string,
    report: Report,
    photos: { kept: readonly string[]; added: readonly File[] },
  ) =>
    ask<ReplayEvent>(`/replays/${id}/events/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      ...bodyOf({ ...report, media: photos.kept }, photos.added),
    }),

  /** Removes it for good, its photos with it. */
  removeEvent: (id: string, eventId: string) =>
    send(`/replays/${id}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }),

  /** Where a frozen medium is served from, for an `img` to point at. */
  mediaUrl: (id: string, path: string) => `/replays/${id}/media/${path}`,
}

function bodyOf(event: unknown, photos: readonly File[]): RequestInit {
  if (photos.length === 0) {
    return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }
  }
  const form = new FormData()
  form.append('event', JSON.stringify(event))
  for (const photo of photos) form.append('photo', photo)
  return { body: form }
}
