import {
  FLOOD_MARK_LABEL,
  GRAVITY_LABELS,
  dataTypesFor,
  type Fallback,
  type ReportCollector,
  type SourceFamily,
  type Threshold,
  type ThresholdNature,
} from '@smmarchives/shared'
import { z } from 'zod'

import type { AquasysClient } from './client.ts'
import { rawThresholdSchema, type RawThreshold } from './raw.ts'

type FetchThresholdsOptions = {
  client: AquasysClient
  collector: ReportCollector
  family: SourceFamily
  sourceIds: readonly number[]
}

/**
 * Reads the thresholds of a set of sources and classifies each one. Thresholds
 * carry no date, so a replay freezes them at build time: today's thresholds
 * would give a past event a false chronology.
 */
export async function fetchThresholds(options: FetchThresholdsOptions): Promise<Threshold[]> {
  const thresholds: Threshold[] = []
  const tick = options.collector.progressEvery(options.sourceIds.length, 'thresholds')

  for (const sourceId of options.sourceIds) {
    try {
      const rows = z
        .array(rawThresholdSchema)
        .parse(await options.client.thresholds(options.family, sourceId))

      if (rows.length === 0) {
        options.collector.withoutData(sourceId)
      } else {
        thresholds.push(...classify(rows, sourceId, options.family, options.collector))
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
 * `category` and `isOverrunThreshold` are absent on part of the fleet: what is
 * inferred from the label, or from the rest of the group, is reported.
 */
function classify(
  rows: readonly RawThreshold[],
  sourceId: number,
  family: SourceFamily,
  collector: ReportCollector,
): Threshold[] {
  const table = dataTypesFor(family)
  const droughtDataTypes = new Set(
    rows.filter(isDeclaredDrought).map((row) => String(row.dataType)),
  )
  const fallingDataTypes = fallingLadders(rows)

  const classified: Threshold[] = []
  for (const row of rows) {
    const dataType = Number(row.dataType)
    const quantity = table.byTypeId(dataType)?.quantity
    if (quantity === undefined) {
      collector.fellBackTo({
        subject: `source ${sourceId}, threshold ${row.id} "${row.name}"`,
        rule: `dataType ${row.dataType} is in no ${family} data type table`,
        applied: 'threshold dropped',
      })
      continue
    }

    const { nature, fallback } = natureOf(row, {
      groupIsDrought: droughtDataTypes.has(String(row.dataType)),
      groupFalls: fallingDataTypes.has(String(row.dataType)),
    })
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
  group: { groupIsDrought: boolean; groupFalls: boolean },
): { nature: ThresholdNature; fallback: Fallback | undefined } {
  const subject = `threshold ${row.id} "${row.name}"`

  if (row.category === 2) return { nature: 'flood-mark', fallback: undefined }

  if (FLOOD_MARK_LABEL.test(row.name)) {
    return {
      nature: 'flood-mark',
      fallback: { subject, rule: 'no category', applied: 'flood mark, from its label' },
    }
  }

  if (isDeclaredDrought(row)) return { nature: 'drought-threshold', fallback: undefined }

  if (group.groupIsDrought) {
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

  if (group.groupFalls) {
    return {
      nature: 'drought-threshold',
      fallback: {
        subject,
        rule: 'no category and no isOverrunThreshold',
        applied: 'drought threshold, its values fall as its labels rise in gravity',
      },
    }
  }

  return {
    nature: 'alert-level',
    fallback: { subject, rule: 'no category', applied: 'alert level, the remaining nature' },
  }
}

/**
 * The data types whose ladder falls as its labels rise in gravity, which only a
 * drought ladder does. Two recognised labels at least and a strict fall across
 * all of them, or nothing is decided. A ladder any rung of which declares its
 * nature is read as declared, never inferred.
 */
function fallingLadders(rows: readonly RawThreshold[]): Set<string> {
  const ladders = new Map<string, Array<{ gravity: number; value: number }>>()
  const rungs = rows.filter((row) => row.category !== 2 && !FLOOD_MARK_LABEL.test(row.name))
  const declared = new Set(rungs.filter(declaresItsNature).map((row) => String(row.dataType)))
  for (const row of rungs) {
    const key = String(row.dataType)
    if (declared.has(key)) continue
    const gravity = gravityOf(row.name)
    if (gravity === undefined) continue

    const ladder = ladders.get(key)
    if (ladder === undefined) ladders.set(key, [{ gravity, value: row.value }])
    else ladder.push({ gravity, value: row.value })
  }

  return new Set([...ladders].filter(([, rungs]) => falls(rungs)).map(([key]) => key))
}

function falls(rungs: ReadonlyArray<{ gravity: number; value: number }>): boolean {
  if (rungs.length < 2) return false
  const sorted = rungs.toSorted((a, b) => a.gravity - b.gravity)
  return sorted.every(
    (rung, index) =>
      index === 0 ||
      (rung.gravity > sorted[index - 1]!.gravity && rung.value < sorted[index - 1]!.value),
  )
}

function declaresItsNature(row: RawThreshold): boolean {
  return row.category !== undefined || row.isOverrunThreshold !== undefined
}

function gravityOf(label: string): number | undefined {
  return GRAVITY_LABELS.find(([pattern]) => pattern.test(label))?.[1]
}

/** Drought ladders are the only thresholds whose values decrease as things worsen. */
function isDeclaredDrought(row: RawThreshold): boolean {
  return row.isOverrunThreshold !== undefined && Number(row.isOverrunThreshold) === 0
}
