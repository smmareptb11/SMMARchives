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
   * The step actually obtained, per quantity: a station's level and flow share
   * their timestamps, and a median over both reads as zero. `null` marks a
   * source and quantity asked for that returned nothing.
   */
  density: Density[]
  /** Rows whose date or value was unreadable; kept out rather than guessed. */
  rowsDropped: number
}

/**
 * Reads the measures of a set of sources over a window, one call per source and
 * per quantity: Aquasys has no grouped retrieval.
 */
/* eslint-disable-next-line max-statements -- one call per source and per quantity, each answer
   feeding three accumulators */
export async function fetchMeasures(options: FetchMeasuresOptions): Promise<MeasuresResult> {
  // Once, not per source: an unmappable quantity is one fallback in the report.
  const requested = resolveQuantities(options)

  const series: Measure[][] = []
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
        const decoded = decode(rows, options.family, sourceId, quantity)
        rowsDropped += rows.length - decoded.length

        const kept = firstPerInstant(
          cropToWindow(decoded, options.window, (measure) => measure.at),
          options.collector,
        )
        series.push(kept)
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

  return { measures: series.flat(), density, rowsDropped }
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
 * One measure per instant of a series, the first the source returned: storage
 * keys on the instant and would refuse the whole data set over a second one.
 * The crossings keep the first as well.
 */
function firstPerInstant(series: readonly Measure[], collector: ReportCollector): Measure[] {
  const seen = new Set<number>()
  const kept = series.filter((measure) => {
    const at = toEpochMilliseconds(measure.at)
    if (seen.has(at)) return false
    seen.add(at)
    return true
  })

  const dropped = series.length - kept.length
  if (dropped > 0) {
    const { sourceId, quantity } = series[0]!
    collector.fellBackTo({
      subject: `source ${sourceId} ${quantity}`,
      rule: 'one measure per instant',
      applied: `${dropped} measure(s) on an instant already seen were dropped, the first kept`,
    })
  }
  return kept
}

/**
 * Turns positional rows into measures. The response is an array of arrays, not
 * the documented array of objects; only indices 0 to 3 are identified, and the
 * rest stays unread: index 16 holds an operator login, and the interface is public.
 */
function decode(
  rows: readonly unknown[][],
  family: SourceFamily,
  sourceId: number,
  quantity: Quantity,
): Measure[] {
  const measures: Measure[] = []

  for (const row of rows) {
    const epoch = row[MEASURE_COLUMN.epochMilliseconds]
    const value = row[MEASURE_COLUMN.value]
    if (typeof epoch !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) continue

    try {
      measures.push({ family, sourceId, quantity, at: fromEpochMilliseconds(epoch), value })
    } catch {
      // One bad row, not a bad series; counted in `rowsDropped`.
    }
  }

  return measures
}
