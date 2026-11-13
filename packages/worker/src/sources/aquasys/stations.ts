import {
  SOURCE_LABEL,
  contains,
  dataTypesFor,
  isSimulatedRainGauge,
  levelDatumOf,
  type BoundingBox,
  type Position,
  type Quantity,
  type RainGauge,
  type ReportCollector,
  type SourceFamily,
  type Station,
  type StationCategory,
} from '@smmarchives/shared'
import { z } from 'zod'

import type { AquasysClient } from './client.ts'
import { ngfDatumOf } from './ngf-datum.ts'
import { positionOf } from './position.ts'
import {
  rawDetailSchema,
  rawNetworkLinkSchema,
  rawRainGaugeSchema,
  rawStationSchema,
  type RawRainGauge,
  type RawStation,
} from './raw.ts'
import { typeStations, type StationTyping } from './station-typing.ts'

export type FetchReferentialOptions = {
  client: AquasysClient
  collector: ReportCollector
  /**
   * Keeps only the sources inside it, before the per-source detail calls.
   *
   * Aquasys has no spatial filtering, so the whole list is loaded — that costs
   * one request — but everything after the filter costs one request per source.
   */
  extent: BoundingBox | undefined
}

type Quantities = Map<number, Quantity[]>

/** What the detail of each source says, by source. */
type Details = { quantities: Quantities; datums: Map<number, number | null> }
type Placed<T> = { row: T; position: Position | null }

/**
 * The hydrological station referential, reprojected, typed and cropped.
 *
 * Referential dates are not exposed: `creationDate` takes negative values and
 * `closeDate` is nearly always absent, so the fleet of a replay is deduced from
 * the measures actually returned, never from metadata.
 */
export async function fetchStations(options: FetchReferentialOptions): Promise<Station[]> {
  const rows = await listStations(options.client, options.collector)

  const inside = retain(
    rows.map((row) => ({
      row,
      position: positionOf(
        row,
        row.projection,
        `station ${row.id}`,
        options.collector,
        options.extent,
      ),
    })),
    options.extent,
  )
  const details = await detailsOf(
    options,
    'hydro',
    inside.map(({ row }) => row.id),
  )

  return inside.map(({ row, position }) => ({
    ...commonFields(row, position, details.quantities),
    category: row.category,
    ngfDatum: details.datums.get(row.id) ?? null,
    levelDatum: levelDatumOf(row.id),
  }))
}

/**
 * The rain gauge referential.
 *
 * Rain gauges are not typed — the categories only exist for watercourse
 * stations — and their coordinates are heterogeneous: most are already in
 * degrees, a handful in Lambert 93, one has none at all.
 */
export async function fetchRainGauges(options: FetchReferentialOptions): Promise<RainGauge[]> {
  const rows = instrumentsOf(await listRainGauges(options.client), options.collector)

  const inside = retain(
    rows.map((row) => ({
      row,
      position: positionOf(
        row,
        row.projectionType,
        `rain gauge ${row.id}`,
        options.collector,
        options.extent,
      ),
    })),
    options.extent,
  )
  const details = await detailsOf(
    options,
    'rain-gauge',
    inside.map(({ row }) => row.id),
  )

  return inside.map(({ row, position }) => commonFields(row, position, details.quantities))
}

/**
 * The rain gauges that measure, without the ones Aquasys simulates.
 *
 * Left out before anything costs a request: two in three of the fleet are
 * reanalysis cells, which cover the map in a grid of triangles and repeat each
 * other's names. Said once in the report, since the codes alone decide it.
 */
function instrumentsOf(rows: RawRainGauge[], collector: ReportCollector): RawRainGauge[] {
  const instruments = rows.filter((row) => !isSimulatedRainGauge(row.code))
  const simulated = rows.length - instruments.length
  if (simulated > 0) {
    collector.fellBackTo({
      subject: `${String(simulated)} rain gauge(s)`,
      rule: 'simulated, recognised by a SAFRAN_ or X…Y… code',
      applied: 'rain gauges left out',
    })
  }
  return instruments
}

/**
 * A source without a position cannot be judged against an extent, so it is
 * dropped when one is given and kept when none is.
 */
function retain<T>(placed: readonly Placed<T>[], extent: BoundingBox | undefined): Placed<T>[] {
  if (extent === undefined) return [...placed]
  return placed.filter((one) => contains(extent, one.position))
}

/** Everything the two families describe the same way. */
function commonFields(
  row: RawStation | RawRainGauge,
  position: Position | null,
  details: Quantities,
) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    comment: row.comment ?? null,
    townCode: row.townCode ?? null,
    altitude: row.altitude ?? null,
    position,
    quantities: details.get(row.id) ?? null,
  }
}

/**
 * Reads `link_pointPrels` on each retained source to learn what it measures,
 * and `link_altimetrySystems` to learn the NGF altitude of its gauge zero.
 *
 * The only reliable way to know what a source measures: `/chronic/stats` takes
 * up to 5.5 s on a single station with a long history. The datum comes from the
 * same call, which is made anyway.
 */
async function detailsOf(
  options: FetchReferentialOptions,
  family: SourceFamily,
  ids: readonly number[],
): Promise<Details> {
  const quantities: Quantities = new Map()
  const datums = new Map<number, number | null>()
  const table = dataTypesFor(family)
  const label = SOURCE_LABEL[family]
  const tick = options.collector.progressEvery(ids.length, `${label} details`)

  for (const id of ids) {
    try {
      const detail = rawDetailSchema.parse(await options.client.detail(family, id))
      const found = (detail.link_pointPrels ?? []).flatMap((point) => {
        const dataType = table.byTypeId(point.typeId)
        return dataType === undefined ? [] : [dataType.quantity]
      })
      quantities.set(id, [...new Set(found)])
      datums.set(id, ngfDatumOf(detail.link_altimetrySystems))
    } catch (error) {
      options.collector.failed(`${label} ${id} detail`, error)
    }
    tick()
  }

  return { quantities, datums }
}

type TypedStation = RawStation & { category: StationCategory }

/**
 * Reads a whole family referential.
 *
 * Always the full list: the identifier space is sparse — 94 stations spread
 * over 1 to 160, 229 rain gauges over 4 to 744 — so a range is never
 * enumerated, and `limit` returns a non-deterministic slice.
 *
 * A station no network types is out of scope, and dropped here, before any
 * call is spent on it — and said, once for all of them: a station missing from
 * the map is otherwise indistinguishable from one Aquasys never had.
 */
async function listStations(
  client: AquasysClient,
  collector: ReportCollector,
): Promise<TypedStation[]> {
  const rows = z.array(rawStationSchema).parse(await client.list('hydro'))
  const typing = await stationCategories(client, collector)

  const untyped = rows.filter((row) => !typing.onTypingNetwork.has(row.id)).map((row) => row.id)
  if (untyped.length > 0) {
    collector.fellBackTo({
      subject: `stations ${untyped.sort((one, other) => one - other).join(', ')}`,
      rule: 'on no network that types a station',
      applied: 'stations dropped',
    })
  }

  return rows.flatMap((row) => {
    const category = typing.categories.get(row.id)
    return category === undefined ? [] : [{ ...row, category }]
  })
}

async function listRainGauges(client: AquasysClient): Promise<RawRainGauge[]> {
  return z.array(rawRainGaugeSchema).parse(await client.list('rain-gauge'))
}

/** One call for the whole fleet, whatever its size. */
async function stationCategories(
  client: AquasysClient,
  collector: ReportCollector,
): Promise<StationTyping> {
  const links = z.array(rawNetworkLinkSchema).parse(await client.networkLinks())
  const typing = typeStations(links)
  for (const fallback of typing.fallbacks) collector.fellBackTo(fallback)
  return typing
}
