import type { DatasetName } from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'
import { readEvents, writeEvents } from './events.ts'
import { readLayers, writeLayers } from './layers.ts'
import {
  readRadarSeries,
  readWebcamImages,
  writeRadarSeries,
  writeWebcamImages,
} from './media-index.ts'
import { readMeasures, readThresholds, writeMeasures, writeThresholds } from './measurements.ts'
import { readReferential, readWebcams, writeReferential, writeWebcams } from './sources.ts'

/**
 * Where a data set lands, and how it comes back.
 *
 * The name says the shape, so the port keeps one generic write: a lane hands
 * over what it collected and this table knows which rows it becomes. The read
 * is the same mapping the other way, and it is what preservation rests on — a
 * re-run compares what a source still offers against what the replay already
 * holds.
 */
/**
 * What a reader may narrow a data set by.
 *
 * Declared per data set rather than shared: a filter a data set knows nothing
 * about is refused rather than ignored, and a client that misspelled one is
 * told instead of being served everything.
 */
export type DatasetFilter = {
  source?: string | undefined
  quantity?: string | undefined
  from?: string | undefined
  to?: string | undefined
  code?: string | undefined
  layer?: string | undefined
}

export type DatasetMapping = {
  /** Replaces every row this replay holds for that data set. */
  write(db: Queryable, replayId: string, data: unknown): Promise<void>
  read(db: Queryable, replayId: string, filter: DatasetFilter): Promise<unknown>
  /** The filters this data set answers to, and no other. */
  narrows: readonly (keyof DatasetFilter)[]
}

export const MAPPINGS: Record<DatasetName, DatasetMapping> = {
  stations: { write: writeReferential, read: readReferential, narrows: [] },
  thresholds: { write: writeThresholds, read: readThresholds, narrows: [] },
  measures: {
    write: writeMeasures,
    read: (db, id, filter) => readMeasures(db, id, filter),
    narrows: ['source', 'quantity', 'from', 'to'],
  },
  events: { write: writeEvents, read: readEvents, narrows: [] },
  'reference-layers': {
    write: writeLayers,
    read: (db, id, filter) => readLayers(db, id, filter.layer),
    narrows: ['layer'],
  },
  webcams: { write: writeWebcams, read: readWebcams, narrows: [] },
  'webcam-images': {
    write: writeWebcamImages,
    read: (db, id, filter) => readWebcamImages(db, id, filter.code),
    narrows: ['code'],
  },
  'radar-rainfall': { write: writeRadarSeries, read: readRadarSeries, narrows: [] },
}

export { readEvents, readLayers, readMeasures, readRadarSeries, readReferential, readThresholds }
export { readWebcamImages, readWebcams }
