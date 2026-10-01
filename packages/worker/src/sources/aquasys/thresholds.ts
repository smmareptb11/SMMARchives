import {
  dataTypesFor,
  type Fallback,
  type ReportCollector,
  type Threshold,
  type ThresholdNature,
} from '@smmarchives/shared'
import { z } from 'zod'

import type { AquasysClient } from './client.ts'
import { rawThresholdSchema, type RawThreshold } from './raw.ts'

export type FetchThresholdsOptions = {
  client: AquasysClient
  collector: ReportCollector
  /** Stations only: no rain gauge of the fleet carries a threshold worth freezing. */
  sourceIds: readonly number[]
}

const FLOOD_MARK_LABEL = /^\s*crue\s+du\b/i

/**
 * Reads the thresholds of a set of stations and classifies each one.
 *
 * Thresholds carry no date: they are copied into a replay at generation time,
 * because reading today's thresholds to reconstruct a past event produces a
 * false chronology. No value is configurable here — the API's value is taken as
 * it comes.
 */
export async function fetchThresholds(options: FetchThresholdsOptions): Promise<Threshold[]> {
  const thresholds: Threshold[] = []
  const tick = options.collector.progressEvery(options.sourceIds.length, 'thresholds')

  for (const sourceId of options.sourceIds) {
    try {
      const rows = z
        .array(rawThresholdSchema)
        .parse(await options.client.stationThresholds(sourceId))

      if (rows.length === 0) {
        options.collector.withoutData(sourceId)
      } else {
        thresholds.push(...classify(rows, sourceId, options.collector))
      }
    } catch (error) {
      options.collector.failed(`source ${sourceId} thresholds`, error)
    }
    tick()
  }

  return thresholds
}

/**
 * Sorts one source's thresholds into the three natures the API mixes.
 *
 * `category` and `isOverrunThreshold` are absent on part of the fleet — station
 * 85 carries a Vigilance / Alerte / Crise ladder without either, where stations
 * 84 and 86 carry both — so classification cannot rest on them alone. What is
 * inferred from the label, or from the rest of the group, is reported.
 */
function classify(
  rows: readonly RawThreshold[],
  sourceId: number,
  collector: ReportCollector,
): Threshold[] {
  const table = dataTypesFor('hydro')
  const droughtDataTypes = new Set(
    rows.filter(isDeclaredDrought).map((row) => String(row.dataType)),
  )

  const classified: Threshold[] = []
  for (const row of rows) {
    const dataType = Number(row.dataType)
    const quantity = table.byTypeId(dataType)?.quantity
    if (quantity === undefined) {
      collector.fellBackTo({
        subject: `source ${sourceId}, threshold ${row.id} "${row.name}"`,
        rule: `dataType ${row.dataType} is in no hydro data type table`,
        applied: 'threshold dropped',
      })
      continue
    }

    const { nature, fallback } = natureOf(row, droughtDataTypes.has(String(row.dataType)))
    if (fallback !== undefined) {
      collector.fellBackTo({ ...fallback, subject: `source ${sourceId}, ${fallback.subject}` })
    }

    classified.push({
      stationId: sourceId,
      id: row.id,
      label: row.name.trim(),
      quantity,
      value: row.value,
      nature,
      natureIsFallback: fallback !== undefined,
      color: row.htmlColor ?? null,
    })
  }
  return classified
}

function natureOf(
  row: RawThreshold,
  groupIsDrought: boolean,
): { nature: ThresholdNature; fallback: Fallback | undefined } {
  const subject = `threshold ${row.id} "${row.name}"`

  if (row.category === 2) return { nature: 'flood-mark', fallback: undefined }

  if (FLOOD_MARK_LABEL.test(row.name)) {
    return {
      nature: 'flood-mark',
      fallback: { subject, rule: 'no category', applied: 'flood mark, from the label prefix' },
    }
  }

  if (isDeclaredDrought(row)) return { nature: 'drought-threshold', fallback: undefined }

  if (groupIsDrought) {
    return {
      nature: 'drought-threshold',
      fallback: {
        subject,
        rule: 'no category and no isOverrunThreshold',
        applied: 'drought threshold, from the rest of the ladder on this quantity',
      },
    }
  }

  if (row.category === 1) return { nature: 'alert-level', fallback: undefined }

  return {
    nature: 'alert-level',
    fallback: { subject, rule: 'no category', applied: 'alert level, the remaining nature' },
  }
}

/** Drought ladders are the only thresholds whose values decrease as things worsen. */
function isDeclaredDrought(row: RawThreshold): boolean {
  return row.isOverrunThreshold !== undefined && Number(row.isOverrunThreshold) === 0
}
