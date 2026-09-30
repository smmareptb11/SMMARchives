import {
  SOURCE_LABEL,
  contains,
  type BoundingBox,
  type ReportCollector,
  type SourceFamily,
  type StationCategory,
} from '@smmarchives/shared'
import { z } from 'zod'

import type { AquasysClient } from './client.ts'
import { positionOf } from './position.ts'
import {
  rawNetworkLinkSchema,
  rawNetworkSchema,
  rawRainGaugeSchema,
  rawStationSchema,
  type RawRainGauge,
  type RawStation,
} from './raw.ts'
import { typeStations } from './station-typing.ts'

export type TypedStation = RawStation & { category: StationCategory }

/**
 * Reads a whole family referential.
 *
 * Always the full list: the identifier space is sparse — 94 stations spread
 * over 1 to 160, 229 rain gauges over 4 to 744 — so a range is never
 * enumerated, and `limit` returns a non-deterministic slice.
 *
 * A station no network types is out of scope, and dropped here, before any
 * call is spent on it.
 */
export async function listStations(
  client: AquasysClient,
  collector: ReportCollector,
): Promise<TypedStation[]> {
  const rows = z.array(rawStationSchema).parse(await client.list('hydro'))
  const categories = await stationCategories(client, collector)
  return rows.flatMap((row) => {
    const category = categories.get(row.id)
    return category === undefined ? [] : [{ ...row, category }]
  })
}

export async function listRainGauges(client: AquasysClient): Promise<RawRainGauge[]> {
  return z.array(rawRainGaugeSchema).parse(await client.list('rain-gauge'))
}

/** Two calls for the whole fleet, whatever its size. */
async function stationCategories(
  client: AquasysClient,
  collector: ReportCollector,
): Promise<ReadonlyMap<number, StationCategory>> {
  const links = z.array(rawNetworkLinkSchema).parse(await client.networkLinks())
  const networks = z.array(rawNetworkSchema).parse(await client.networks())
  const typing = typeStations(links, networks)
  for (const fallback of typing.fallbacks) collector.fellBackTo(fallback)
  return typing.categories
}

function sandreCodeOf(row: RawStation | RawRainGauge): number | undefined {
  const code = 'projection' in row ? row['projection'] : row['projectionType']
  return typeof code === 'number' ? code : undefined
}

/**
 * Which sources a run works on, as one choice rather than two flags.
 *
 * An extent and an explicit list answer the same question, so a shape holding
 * both is a shape that can contradict itself. It did: a run once returned a
 * station 60 km outside the extent its own report announced. Here the caller
 * cannot express the contradiction, and nothing has to catch it later.
 */
export type SourceScope =
  | { readonly kind: 'whole-family' }
  | { readonly kind: 'extent'; readonly extent: BoundingBox }
  | { readonly kind: 'ids'; readonly ids: readonly number[] }

export type SourceSelection = {
  client: AquasysClient
  collector: ReportCollector
  family: SourceFamily
  scope: SourceScope
}

/**
 * The identifiers a run should work on.
 *
 * The referential buys the extent filter — one request, and two more that type
 * the stations — and the filter is what makes the rest cheap: thresholds and measures cost one request per source, so narrowing the
 * fleet here rather than downstream is the difference between hundreds of calls
 * and a few dozen.
 */
export async function listSourceIds(selection: SourceSelection): Promise<number[]> {
  if (selection.scope.kind === 'ids') return inScope(selection.scope.ids, selection)

  const rows =
    selection.family === 'hydro'
      ? await listStations(selection.client, selection.collector)
      : await listRainGauges(selection.client)

  if (selection.scope.kind === 'whole-family') return rows.map((row) => row.id)

  const { extent } = selection.scope
  const label = SOURCE_LABEL[selection.family]
  return rows
    .filter((row) =>
      contains(
        extent,
        positionOf(row, sandreCodeOf(row), `${label} ${row.id}`, selection.collector, extent),
      ),
    )
    .map((row) => row.id)
}

/**
 * An explicit list, less the stations a replay never holds.
 *
 * Only stations are out of scope: a rain gauge sharing one of their numbers is
 * another source.
 */
async function inScope(ids: readonly number[], selection: SourceSelection): Promise<number[]> {
  if (selection.family !== 'hydro') return [...ids]

  const categories = await stationCategories(selection.client, selection.collector)
  return ids.filter((id) => {
    if (categories.has(id)) return true
    selection.collector.fellBackTo({
      subject: `station ${id}`,
      rule: 'requested explicitly, but out of scope',
      applied: 'station dropped',
    })
    return false
  })
}
