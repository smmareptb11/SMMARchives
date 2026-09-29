import {
  SOURCE_LABEL,
  contains,
  isOutOfScope,
  type BoundingBox,
  type ReportCollector,
  type SourceFamily,
} from '@smmarchives/shared'
import { z } from 'zod'

import type { AquasysClient } from './client.ts'
import { positionOf } from './position.ts'
import { rawRainGaugeSchema, rawStationSchema, type RawRainGauge, type RawStation } from './raw.ts'

/**
 * Reads a whole family referential.
 *
 * Always the full list: the identifier space is sparse — 94 stations spread
 * over 1 to 160, 229 rain gauges over 4 to 744 — so a range is never
 * enumerated, and `limit` returns a non-deterministic slice.
 *
 * Stations a replay no longer holds are dropped here, before any call is spent
 * on them.
 */
export async function listStations(client: AquasysClient): Promise<RawStation[]> {
  const rows = z.array(rawStationSchema).parse(await client.list('hydro'))
  return rows.filter((row) => !isOutOfScope(row.id))
}

export async function listRainGauges(client: AquasysClient): Promise<RawRainGauge[]> {
  return z.array(rawRainGaugeSchema).parse(await client.list('rain-gauge'))
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
 * One request buys the extent filter, and the filter is what makes the rest
 * cheap: thresholds and measures cost one request per source, so narrowing the
 * fleet here rather than downstream is the difference between hundreds of calls
 * and a few dozen.
 */
export async function listSourceIds(selection: SourceSelection): Promise<number[]> {
  if (selection.scope.kind === 'ids') return [...selection.scope.ids]

  const rows =
    selection.family === 'hydro'
      ? await listStations(selection.client)
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
