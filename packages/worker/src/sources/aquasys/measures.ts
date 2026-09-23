import {
  cropToWindow,
  dataTypesFor,
  fromEpochMilliseconds,
  medianStepMinutes,
  toEpochMilliseconds,
  type Measure,
  type Quantity,
  type ReportCollector,
  type SourceFamily,
  type TimeWindow,
} from '@smmarchives/shared'

import type { AquasysClient } from './client.ts'
import { MEASURE_COLUMN, rawMeasureRowsSchema } from './raw.ts'

export type FetchMeasuresOptions = {
  client: AquasysClient
  collector: ReportCollector
  family: SourceFamily
  sourceIds: readonly number[]
  quantities: readonly Quantity[]
  window: TimeWindow
}

export type Density = {
  sourceId: number
  quantity: Quantity
  medianStepMinutes: number | null
}

export type MeasuresResult = {
  measures: Measure[]
  /**
   * The density actually obtained, so a replay states its own step rather than
   * presenting a 41-minute series as a 5-minute one. `null` marks a source and
   * quantity asked for and returning nothing, which `data` cannot express.
   *
   * Per quantity and not per source: a station returns its level and its flow
   * on the same timestamps, and a median over the two interleaved reads as
   * zero.
   */
  density: Density[]
  /** Rows whose date or value was unreadable; kept out rather than guessed. */
  rowsDropped: number
}

/**
 * Reads the measures of a set of sources over a window.
 *
 * One call per source and per quantity: `stationId` is a single integer and
 * there is no grouped retrieval. Which is why the caller resolves `sourceIds`
 * through the extent first — the filter upstream is what keeps this loop
 * short.
 */
/* eslint-disable-next-line max-statements -- one call per source and per quantity, each answer
   feeding three accumulators */
export async function fetchMeasures(options: FetchMeasuresOptions): Promise<MeasuresResult> {
  // Resolved once, not per source: an unmappable quantity is one fallback, not
  // 94 identical ones filling the report.
  const requested = resolveQuantities(options)

  const measures: Measure[] = []
  const density: Density[] = []
  let rowsDropped = 0

  const window = {
    startEpochMilliseconds: toEpochMilliseconds(options.window.from),
    endEpochMilliseconds: toEpochMilliseconds(options.window.to),
  }
  const tick = options.collector.progressEvery(
    options.sourceIds.length * requested.length,
    'measures',
  )

  for (const sourceId of options.sourceIds) {
    let foundForSource = false

    for (const { quantity, typeId } of requested) {
      try {
        const rows = rawMeasureRowsSchema.parse(
          await options.client.measures(options.family, { sourceId, dataType: typeId, ...window }),
        )
        const decoded = decode(rows, sourceId, quantity)
        rowsDropped += rows.length - decoded.length

        const kept = cropToWindow(decoded, options.window, (measure) => measure.at)
        measures.push(...kept)
        density.push({
          sourceId,
          quantity,
          medianStepMinutes: medianStepMinutes(kept.map((measure) => measure.at)),
        })
        foundForSource ||= kept.length > 0
      } catch (error) {
        options.collector.failed(`source ${sourceId} ${quantity}`, error)
      }
      tick()
    }

    if (!foundForSource) options.collector.withoutData(sourceId)
  }

  return { measures, density, rowsDropped }
}

function resolveQuantities(
  options: FetchMeasuresOptions,
): Array<{ quantity: Quantity; typeId: number }> {
  const table = dataTypesFor(options.family)
  return options.quantities.flatMap((quantity) => {
    const dataType = table.byQuantity(quantity)
    if (dataType === undefined) {
      options.collector.fellBackTo({
        subject: `family ${options.family}`,
        rule: `${quantity} is in no ${options.family} data type table`,
        applied: 'quantity skipped',
      })
      return []
    }
    return [{ quantity, typeId: dataType.typeId }]
  })
}

/**
 * Turns positional rows into measures, reading four columns and no more.
 *
 * The response is an array of arrays, not the documented array of objects.
 * Indices 0 to 3 are the only ones identified with certainty; the rest are left
 * unread — index 16 holds an operator login, and the consultation interface is
 * public. Everything needed to tell rows apart is a request parameter, so there
 * is nothing to gain from decoding further.
 */
function decode(rows: readonly unknown[][], sourceId: number, quantity: Quantity): Measure[] {
  const measures: Measure[] = []

  for (const row of rows) {
    const epoch = row[MEASURE_COLUMN.epochMilliseconds]
    const value = row[MEASURE_COLUMN.value]
    if (typeof epoch !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) continue

    try {
      measures.push({ sourceId, quantity, at: fromEpochMilliseconds(epoch), value })
    } catch {
      // An epoch outside the plausible range is one bad row, not a bad series:
      // dropping the whole call would lose the 899 good measures around it.
      // The count surfaces in `rowsDropped`.
    }
  }

  return measures
}
