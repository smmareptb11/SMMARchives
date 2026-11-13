import type { DatasetName } from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'
import { readEvents, writeEvents } from './events.ts'
import {
  readRadarSeries,
  readWebcamImages,
  writeRadarSeries,
  writeWebcamImages,
} from './media-index.ts'
import {
  readMeasuredStations,
  readMeasures,
  readThresholds,
  writeMeasuredStations,
  writeMeasures,
  writeThresholds,
} from './measurements.ts'
import { readReferential, readWebcams, writeReferential, writeWebcams } from './sources.ts'

/**
 * What a reader may narrow a data set by. Each data set declares the filters it
 * answers to, and another one is refused rather than ignored.
 */
export type DatasetFilter = {
  family?: string | undefined
  source?: string | undefined
  quantity?: string | undefined
  from?: string | undefined
  to?: string | undefined
  code?: string | undefined
}

export type DatasetMapping = {
  /** Inserts the rows this data set becomes, into a replay that holds none of them yet. */
  write(db: Queryable, replayId: string, data: unknown): Promise<void>
  read(db: Queryable, replayId: string, filter: DatasetFilter): Promise<unknown>
  /** The filters this data set answers to, and no other. */
  narrows: readonly (keyof DatasetFilter)[]
}

/** Where each data set lands, and how it comes back: its name says its shape. */
export const MAPPINGS: Record<DatasetName, DatasetMapping> = {
  stations: { write: writeReferential, read: readReferential, narrows: [] },
  thresholds: { write: writeThresholds, read: readThresholds, narrows: [] },
  measures: {
    write: writeMeasures,
    read: (db, id, filter) => readMeasures(db, id, filter),
    narrows: ['family', 'source', 'quantity', 'from', 'to'],
  },
  'measured-stations': { write: writeMeasuredStations, read: readMeasuredStations, narrows: [] },
  events: { write: writeEvents, read: readEvents, narrows: [] },
  webcams: { write: writeWebcams, read: readWebcams, narrows: [] },
  'webcam-images': {
    write: writeWebcamImages,
    read: (db, id, filter) => readWebcamImages(db, id, filter.code),
    narrows: ['code'],
  },
  'radar-rainfall': { write: writeRadarSeries, read: readRadarSeries, narrows: [] },
}

export { readEvents, readMeasuredStations, readMeasures, readRadarSeries }
export { readReferential, readThresholds }
export { readWebcamImages, readWebcams }
