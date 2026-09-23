import { z } from 'zod'

/**
 * The shapes Aquasys actually returns, as opposed to the ones it documents.
 *
 * This file exists because the OpenAPI specification is wrong, not as a matter
 * of style. It documents an object response where the API returns positional
 * arrays, and an example projection code matching no real station. The
 * correction has been reported for the editor to fix; until it is, what the
 * API actually returns is the reference, and these schemas encode it.
 *
 * Every schema is loose: the fleet is not homogeneous — `altitude` is on 30 of
 * 94 stations, `watershedHead` on one — and an exact schema would reject valid
 * data. Absent fields are absent, not null, except `ngfCote`.
 */

export const rawStationSchema = z.looseObject({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  projection: z.number().optional(),
  comment: z.string().optional(),
  townCode: z.string().optional(),
  altitude: z.number().optional(),
})

export type RawStation = z.infer<typeof rawStationSchema>

export const rawRainGaugeSchema = z.looseObject({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  /** Same meaning as `projection` on a station, under a different name. */
  projectionType: z.number().optional(),
  comment: z.string().optional(),
  townCode: z.string().optional(),
  altitude: z.number().optional(),
})

export type RawRainGauge = z.infer<typeof rawRainGaugeSchema>

/** Measurement points of a source, the reliable way to know what it carries. */
const rawPointPrelSchema = z.looseObject({
  idStation: z.number().int(),
  point: z.number().int(),
  typeId: z.number().int(),
  name: z.string().optional(),
})

export const rawDetailSchema = z.looseObject({
  id: z.number().int(),
  link_pointPrels: z.array(rawPointPrelSchema).optional(),
})

/**
 * `dataType` and `isOverrunThreshold` come back as strings, not numbers, and
 * `category` and `isOverrunThreshold` are absent on part of the fleet.
 */
export const rawThresholdSchema = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  value: z.number(),
  dataType: z.union([z.string(), z.number()]),
  htmlColor: z.string().optional(),
  category: z.number().optional(),
  isOverrunThreshold: z.union([z.string(), z.number()]).optional(),
})

export type RawThreshold = z.infer<typeof rawThresholdSchema>

/**
 * A measure row, positional rather than the documented object.
 *
 * Only indices 0 to 3 are read. Index 16 holds a login — the consultation
 * interface is public, so the row is never kept whole.
 */
const rawMeasureRowSchema = z.array(z.unknown()).min(4)

export const rawMeasureRowsSchema = z.array(rawMeasureRowSchema)

export const MEASURE_COLUMN = {
  sourceId: 0,
  dataType: 1,
  epochMilliseconds: 2,
  value: 3,
} as const
