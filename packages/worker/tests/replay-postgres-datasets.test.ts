import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import type {
  FrozenWebcamImage,
  Measure,
  RadarRainfallSeries,
  ReplayEvent,
  ReplayManifest,
  Threshold,
  Webcam,
} from '@smmarchives/shared'

import { MAPPINGS, readMeasures } from '../src/replay/postgres/datasets/index.ts'
import { writeManifest } from '../src/replay/postgres/manifest.ts'
import { closeDatabase, freshDatabase } from './support/database.ts'

afterAll(closeDatabase)

const PERIOD = { from: '2019-10-22T00:00:00.000Z', to: '2019-10-23T00:00:00.000Z' }

function aReferential() {
  return {
    stations: [
      {
        id: 4,
        code: 'Y1612010',
        name: "L'Aude à Trèbes",
        comment: null,
        townCode: '11399',
        altitude: 62.5,
        position: { lon: 2.4433, lat: 43.21 },
        category: 'watercourse' as const,
        quantities: ['level' as const, 'flow' as const],
        ngfDatum: 56.148,
        levelDatum: 'gauge' as const,
      },
    ],
    rainGauges: [
      {
        id: 4,
        code: 'PLV-11108',
        name: 'Pluviomètre de Couiza',
        comment: 'remplacé en 2019',
        townCode: '11108',
        altitude: null,
        position: null,
        quantities: ['rainfall' as const],
      },
    ],
  }
}

const THRESHOLDS: Threshold[] = [
  {
    stationId: 4,
    id: 11,
    label: 'Vigilance',
    quantity: 'level',
    value: 2.5,
    nature: 'alert-level',
    natureIsFallback: false,
    color: '#f0a30a',
  },
]

const MEASURES: Measure[] = [
  { family: 'hydro', sourceId: 4, quantity: 'level', at: '2019-10-22T06:00:00.000Z', value: 1.25 },
  { family: 'hydro', sourceId: 4, quantity: 'level', at: '2019-10-22T06:05:00.000Z', value: 1.31 },
  {
    family: 'rain-gauge',
    sourceId: 4,
    quantity: 'rainfall',
    at: '2019-10-22T06:00:00.000Z',
    value: 12,
  },
]

const EVENTS: ReplayEvent[] = [
  {
    id: 'crossing-4-level-11',
    origin: 'automatic',
    category: 'threshold-crossing',
    title: "Vigilance franchie à L'Aude à Trèbes",
    description: null,
    producerKind: null,
    link: null,
    severity: 1,
    color: '#f0a30a',
    from: '2019-10-22T06:05:00.000Z',
    to: null,
    position: { type: 'Point', coordinates: [2.4433, 43.21] },
    sourceId: 4,
    media: [],
    crossing: {
      thresholdId: 11,
      label: 'Vigilance',
      quantity: 'level',
      value: 2.5,
      natureIsFallback: false,
      measured: 2.6,
      peak: 3.1,
      ladderHeight: 3,
      stillActiveAtEnd: true,
    },
  },
]

const WEBCAMS: Webcam[] = [
  {
    code: '215',
    commune: 'Mailhac',
    url: 'https://media.ceneau.test/215',
    operational: true,
    position: { lon: 2.8278, lat: 43.3031 },
  },
]

// Two, so the round trip covers a view the replay holds a reduction of and one
// it does not: a lane reads null as "draw the full image", and a column that
// dropped the difference would be invisible until the strip weighed thirty
// megabytes.
const IMAGES: FrozenWebcamImage[] = [
  {
    code: '215',
    at: '2019-10-22T06:00:00.000Z',
    uri: 'https://media.ceneau.test/215/1571724000.jpg',
    thumbUri: null,
    storedPath: 'webcams/215/1571724000.jpg',
    storedThumbPath: null,
  },
  {
    code: '215',
    at: '2019-10-22T12:00:00.000Z',
    uri: 'https://media.ceneau.test/215/1571745600.jpg',
    thumbUri: 'https://media.ceneau.test/215/thumbs/1571745600.jpg',
    storedPath: 'webcams/215/1571745600.jpg',
    storedThumbPath: 'webcams/215/thumbs/1571745600.jpg',
  },
]

const SERIES: RadarRainfallSeries[] = [
  {
    delivery: '20034',
    product: 'pluvio5mn',
    medianStepMinutes: 5,
    frames: [
      { at: '2019-10-22T06:00:00.000Z', path: '20034/pluvio5mn/1571724000.png' },
      { at: '2019-10-22T06:05:00.000Z', path: '20034/pluvio5mn/1571724300.png' },
    ],
  },
]

function aManifest(replayId: string): ReplayManifest {
  return {
    schemaVersion: 1,
    id: replayId,
    label: null,
    extent: null,
    period: PERIOD,
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:00:00.000Z',
    state: 'running',
    lanes: {},
    datasets: {},
    media: { copied: 0, failed: 0, bytes: 0 },
  }
}

describe('a data set in the database', () => {
  let pool: Pool
  let id: string

  beforeEach(async () => {
    pool = await freshDatabase('test_datasets')
    id = randomUUID()
    await writeManifest(pool, aManifest(id))
  })

  it('reads back the referential, both families, as it was given', async () => {
    await MAPPINGS.stations.write(pool, id, aReferential())

    expect(await MAPPINGS.stations.read(pool, id, {})).toEqual(aReferential())
  })

  it('keeps a station and a rain gauge that share a number apart', async () => {
    await MAPPINGS.stations.write(pool, id, aReferential())

    const read = (await MAPPINGS.stations.read(pool, id, {})) as ReturnType<typeof aReferential>
    expect(read.stations[0]?.name).toBe("L'Aude à Trèbes")
    expect(read.rainGauges[0]?.name).toBe('Pluviomètre de Couiza')
  })

  it('reads back the measured stations in order', async () => {
    await MAPPINGS['measured-stations'].write(pool, id, [152, 84, 2])

    expect(await MAPPINGS['measured-stations'].read(pool, id, {})).toEqual([2, 84, 152])
  })

  it('reads back the thresholds as they were given', async () => {
    await MAPPINGS.thresholds.write(pool, id, THRESHOLDS)

    expect(await MAPPINGS.thresholds.read(pool, id, {})).toEqual(THRESHOLDS)
  })

  it('reads back the measures as they were given', async () => {
    await MAPPINGS.measures.write(pool, id, MEASURES)

    expect(await MAPPINGS.measures.read(pool, id, {})).toEqual(MEASURES)
  })

  it('keeps the measures of a station and a rain gauge that share a number and a quantity apart', async () => {
    const shared = { sourceId: 4, quantity: 'level' as const, at: '2019-10-22T06:00:00.000Z' }
    const both: Measure[] = [
      { ...shared, family: 'hydro', value: 1.25 },
      { ...shared, family: 'rain-gauge', value: 7 },
    ]
    await MAPPINGS.measures.write(pool, id, both)

    expect(await readMeasures(pool, id, { family: 'rain-gauge' })).toEqual([both[1]])
  })

  it('reads back only the window asked for', async () => {
    await MAPPINGS.measures.write(pool, id, MEASURES)

    const read = await readMeasures(pool, id, {
      quantity: 'level',
      from: '2019-10-22T06:02:00.000Z',
    })
    expect(read.map((one) => one.value)).toEqual([1.31])
  })

  it('reads back the events as they were given', async () => {
    await MAPPINGS.events.write(pool, id, EVENTS)

    expect(await MAPPINGS.events.read(pool, id, {})).toEqual(EVENTS)
  })

  it('reads back the webcams as they were given', async () => {
    await MAPPINGS.webcams.write(pool, id, WEBCAMS)

    expect(await MAPPINGS.webcams.read(pool, id, {})).toEqual(WEBCAMS)
  })

  it('reads back the frozen images, the path of the copy included', async () => {
    await MAPPINGS['webcam-images'].write(pool, id, IMAGES)

    expect(await MAPPINGS['webcam-images'].read(pool, id, {})).toEqual(IMAGES)
  })

  it('reads back the radar series with their frames in order', async () => {
    await MAPPINGS['radar-rainfall'].write(pool, id, SERIES)

    expect(await MAPPINGS['radar-rainfall'].read(pool, id, {})).toEqual(SERIES)
  })

  it('reads back a radar step that is not a whole number of minutes', async () => {
    const irregular = SERIES.map((one) => ({ ...one, medianStepMinutes: 5.1 }))
    await MAPPINGS['radar-rainfall'].write(pool, id, irregular)

    expect(await MAPPINGS['radar-rainfall'].read(pool, id, {})).toEqual(irregular)
  })

  it('keeps two replays apart', async () => {
    const other = randomUUID()
    await writeManifest(pool, aManifest(other))
    await MAPPINGS.measures.write(pool, id, MEASURES)

    expect(await MAPPINGS.measures.read(pool, other, {})).toEqual([])
  })

  it('takes a data set away with the replay it belongs to', async () => {
    await MAPPINGS.measures.write(pool, id, MEASURES)
    await pool.query('delete from replay where id = $1', [id])

    expect(await MAPPINGS.measures.read(pool, id, {})).toEqual([])
  })
})

describe('a data set written in batches', () => {
  let pool: Pool
  let id: string

  beforeEach(async () => {
    pool = await freshDatabase('test_datasets')
    id = randomUUID()
    await writeManifest(pool, aManifest(id))
  })

  it('stores an event that crossed nothing with no crossing, as SQL reads it', async () => {
    const reported: ReplayEvent = {
      ...EVENTS[0]!,
      id: 'a-report',
      origin: 'manual',
      category: 'field-report',
      producerKind: 'Agent SMMAR',
      severity: null,
      color: null,
      sourceId: null,
      crossing: null,
    }
    await MAPPINGS.events.write(pool, id, [reported])

    const { rows } = await pool.query<{ count: number }>(
      'select count(*)::integer as count from event where replay_id = $1 and crossing is null',
      [id],
    )
    expect(rows[0]?.count).toBe(1)
    expect(await MAPPINGS.events.read(pool, id, {})).toEqual([reported])
  })

  it('reads back more events than one statement takes', async () => {
    const many = Array.from({ length: 2_345 }, (_, index) => ({
      ...EVENTS[0]!,
      id: `crossing-${String(index).padStart(4, '0')}`,
    }))
    await MAPPINGS.events.write(pool, id, many)

    expect(await MAPPINGS.events.read(pool, id, {})).toEqual(many)
  })

  it('orders the thresholds by station number, not as text', async () => {
    const ten = { ...THRESHOLDS[0]!, stationId: 10 }
    const nine = { ...THRESHOLDS[0]!, stationId: 9 }
    await MAPPINGS.thresholds.write(pool, id, [ten, nine])

    const read = (await MAPPINGS.thresholds.read(pool, id, {})) as Threshold[]
    expect(read.map((one) => one.stationId)).toEqual([9, 10])
  })

  it('orders the measures by source number, not as text', async () => {
    const at = '2019-10-22T06:00:00.000Z'
    const measures: Measure[] = [
      { family: 'hydro', sourceId: 10, quantity: 'level', at, value: 1 },
      { family: 'hydro', sourceId: 9, quantity: 'level', at, value: 2 },
    ]
    await MAPPINGS.measures.write(pool, id, measures)

    expect((await readMeasures(pool, id, {})).map((one) => one.sourceId)).toEqual([9, 10])
  })
})
