import { z } from 'zod'

/**
 * The shapes Aquasys actually returns, as opposed to the ones its OpenAPI
 * specification documents: positional arrays where it shows objects, and an
 * example projection code matching no real station.
 *
 * Every schema is loose: fields vary from one source to the next. Absent fields
 * are absent, not null, except `ngfCote`.
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

export const rawNetworkLinkSchema = z.looseObject({
  idStation: z.number().int(),
  idNetwork: z.number().int(),
})

export type RawNetworkLink = z.infer<typeof rawNetworkLinkSchema>

/** Measurement points of a source, the reliable way to know what it carries. */
const rawPointPrelSchema = z.looseObject({
  idStation: z.number().int(),
  point: z.number().int(),
  typeId: z.number().int(),
  name: z.string().optional(),
})

/**
 * A line of a station's altimetric history, of which only the altitude is read.
 * Optional, so a malformed line does not cost the detail its quantities.
 */
const rawAltimetrySchema = z.looseObject({
  altitude: z.number().optional(),
})

export type RawAltimetry = z.infer<typeof rawAltimetrySchema>

export const rawDetailSchema = z.looseObject({
  id: z.number().int(),
  link_pointPrels: z.array(rawPointPrelSchema).optional(),
  link_altimetrySystems: z.array(rawAltimetrySchema).optional(),
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

/** A measure row, positional rather than the documented object; see `decode` for what is read. */
const rawMeasureRowSchema = z.array(z.unknown()).min(4)

export const rawMeasureRowsSchema = z.array(rawMeasureRowSchema)

export const MEASURE_COLUMN = {
  sourceId: 0,
  dataType: 1,
  epochMilliseconds: 2,
  value: 3,
} as const
