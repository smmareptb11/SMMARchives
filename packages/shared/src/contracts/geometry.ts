import { z } from 'zod'

export const positionSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
})

export type Position = z.infer<typeof positionSchema>

export const boundingBoxSchema = z
  .object({
    minLon: z.number().min(-180).max(180),
    minLat: z.number().min(-90).max(90),
    maxLon: z.number().min(-180).max(180),
    maxLat: z.number().min(-90).max(90),
  })
  .refine((box) => box.minLon < box.maxLon && box.minLat < box.maxLat, {
    message: 'has its minimum past its maximum',
  })

export type BoundingBox = z.infer<typeof boundingBoxSchema>

/**
 * Reads `minLon,minLat,maxLon,maxLat` in WGS84.
 *
 * The caller supplies the error, because the same format arrives from two
 * places with two consequences: a `--bbox` flag is a usage error, an
 * environment variable a configuration one.
 *
 * Coordinates are range-checked, not merely counted. An extent nobody could
 * mean — a longitude of 1000 — otherwise passes, matches nothing, and returns
 * an empty collection indistinguishable from an extent that legitimately holds
 * nothing.
 */
export function parseBoundingBox(value: string, fail: (reason: string) => Error): BoundingBox {
  const numbers = value.split(',').map((part) => Number(part.trim()))
  if (numbers.length !== 4 || numbers.some((one) => !Number.isFinite(one))) {
    throw fail('must be four numbers, "minLon,minLat,maxLon,maxLat"')
  }

  const [minLon, minLat, maxLon, maxLat] = numbers as [number, number, number, number]
  const parsed = boundingBoxSchema.safeParse({ minLon, minLat, maxLon, maxLat })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path[0]
    throw fail(
      field === undefined
        ? (issue?.message ?? 'is not a usable extent')
        : `has a ${String(field)} outside the range of valid coordinates`,
    )
  }
  return parsed.data
}

/** Bounds included. A source without a position is never inside an extent. */
export function contains(extent: BoundingBox, position: Position | null): boolean {
  if (position === null) return false
  return (
    position.lon >= extent.minLon &&
    position.lon <= extent.maxLon &&
    position.lat >= extent.minLat &&
    position.lat <= extent.maxLat
  )
}

/** Bounds included: an extent touching the edge of another still lies within it. */
export function encloses(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    inner.minLon >= outer.minLon &&
    inner.maxLon <= outer.maxLon &&
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat
  )
}

/** Nothing when the two share no area, a common edge included. */
export function intersectionOf(one: BoundingBox, other: BoundingBox): BoundingBox | undefined {
  const shared = {
    minLon: Math.max(one.minLon, other.minLon),
    minLat: Math.max(one.minLat, other.minLat),
    maxLon: Math.min(one.maxLon, other.maxLon),
    maxLat: Math.min(one.maxLat, other.maxLat),
  }
  return shared.minLon < shared.maxLon && shared.minLat < shared.maxLat ? shared : undefined
}

/** As much of GeoJSON as a collector needs to check and to walk. */
export const featureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      geometry: z.unknown().nullable(),
      properties: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
})

export type FeatureCollection = z.infer<typeof featureCollectionSchema>
export type Feature = FeatureCollection['features'][number]
