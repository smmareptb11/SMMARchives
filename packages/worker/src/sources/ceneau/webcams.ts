import {
  contains,
  type BoundingBox,
  type Position,
  type ReportCollector,
  type Webcam,
} from '@smmarchives/shared'
import { z } from 'zod'

import type { LizmapClient } from '../lizmap/client.ts'

/**
 * The only source whose cameras have an exploitable archive.
 *
 * The layer holds 24 cameras over 7 sources; the other 19 are live external
 * feeds — web pages or embedded players — with no image history. Filter on
 * `source`, and on nothing else.
 */
const EXPLOITABLE_SOURCE = 'ceneau'

/** No declared CRS on this layer, so WGS84 — Lizmap reprojects on output. */
const pointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
})

const propertiesSchema = z.looseObject({
  code: z.union([z.string(), z.number()]),
  source: z.string(),
  commune: z.string(),
  url: z.string(),
  fonctionnel: z.unknown().optional(),
})

export type FetchWebcamsOptions = {
  client: LizmapClient
  collector: ReportCollector
  /** Keeps only the cameras inside it, so images are fetched for those alone. */
  extent?: BoundingBox | undefined
}

/* eslint-disable-next-line complexity, max-statements -- four ways a camera leaves the
   collection, two of them reported and two silent by design */
export async function fetchWebcamPositions(options: FetchWebcamsOptions): Promise<Webcam[]> {
  const collection = await options.client.getFeature('webcam')

  const webcams: Webcam[] = []
  for (const feature of collection.features) {
    // Filter before validating: the 19 cameras of other sources have no station
    // code, and reporting them would bury the defects that matter.
    if (feature.properties?.['source'] !== EXPLOITABLE_SOURCE) continue

    const properties = propertiesSchema.safeParse(feature.properties)
    if (!properties.success) {
      options.collector.fellBackTo({
        subject: `webcam ${String(feature.properties['code'])}`,
        rule: 'attributes missing from the layer',
        applied: 'camera skipped',
      })
      continue
    }

    const position = positionOf(feature.geometry)
    if (position === undefined) {
      options.collector.fellBackTo({
        subject: `webcam ${properties.data.code}`,
        rule: 'geometry is not a point',
        applied: 'camera skipped',
      })
      continue
    }

    if (options.extent !== undefined && !contains(options.extent, position)) continue

    webcams.push({
      code: String(properties.data.code),
      commune: properties.data.commune,
      url: properties.data.url,
      operational: isOperational(properties.data.fonctionnel),
      position,
    })
  }

  if (webcams.length === 0) options.collector.withoutData(EXPLOITABLE_SOURCE)
  return webcams
}

function positionOf(geometry: unknown): Position | undefined {
  const point = pointSchema.safeParse(geometry)
  if (!point.success) return undefined
  return { lon: point.data.coordinates[0], lat: point.data.coordinates[1] }
}

function isOperational(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return !['0', 'false', 'non', ''].includes(value.toLowerCase())
  return false
}
