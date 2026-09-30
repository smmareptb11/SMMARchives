import {
  SOURCE_LABEL,
  contains,
  dataTypesFor,
  type BoundingBox,
  type DataTypeTable,
  type Position,
  type Quantity,
  type RainGauge,
  type ReportCollector,
  type SourceFamily,
  type Station,
} from '@smmarchives/shared'

import type { AquasysClient } from './client.ts'
import { positionOf } from './position.ts'
import { rawDetailSchema, type RawRainGauge, type RawStation } from './raw.ts'
import { listRainGauges, listStations } from './source-ids.ts'

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
  /**
   * Read `link_pointPrels` on each retained source to learn what it measures.
   *
   * The only reliable way to know: `/chronic/stats` takes up to 5.5 s on a
   * single station with a long history.
   */
  withDetails: boolean
}

type Quantities = Map<number, Quantity[]>
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
  const details = await quantitiesOf(
    options,
    'hydro',
    inside.map(({ row }) => row.id),
  )

  return inside.map(({ row, position }) => ({
    ...commonFields(row, position, details),
    category: row.category,
    categoryIsFallback: false,
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
  const rows = await listRainGauges(options.client)

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
  const details = await quantitiesOf(
    options,
    'rain-gauge',
    inside.map(({ row }) => row.id),
  )

  return inside.map(({ row, position }) => commonFields(row, position, details))
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
  details: Quantities | undefined,
) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    comment: row.comment ?? null,
    townCode: row.townCode ?? null,
    altitude: row.altitude ?? null,
    position,
    quantities: details?.get(row.id) ?? null,
  }
}

function quantitiesOf(
  options: FetchReferentialOptions,
  family: SourceFamily,
  ids: readonly number[],
): Promise<Quantities> | undefined {
  if (!options.withDetails) return undefined

  return fetchQuantities({
    client: options.client,
    collector: options.collector,
    family,
    table: dataTypesFor(family),
    ids,
  })
}

type FetchQuantitiesOptions = {
  client: AquasysClient
  collector: ReportCollector
  family: SourceFamily
  table: DataTypeTable
  ids: readonly number[]
}

async function fetchQuantities(options: FetchQuantitiesOptions): Promise<Quantities> {
  const quantities: Quantities = new Map()
  const label = SOURCE_LABEL[options.family]
  const tick = options.collector.progressEvery(options.ids.length, `${label} details`)

  for (const id of options.ids) {
    try {
      const detail = rawDetailSchema.parse(await options.client.detail(options.family, id))
      const found = (detail.link_pointPrels ?? []).flatMap((point) => {
        const dataType = options.table.byTypeId(point.typeId)
        return dataType === undefined ? [] : [dataType.quantity]
      })
      quantities.set(id, [...new Set(found)])
    } catch (error) {
      options.collector.failed(`${label} ${id} detail`, error)
    }
    tick()
  }

  return quantities
}
