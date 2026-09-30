import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_RADAR_RAINFALL_EXTENT,
  ExitCode,
  windowOf,
  type BoundingBox,
  type Measure,
  type RainGauge,
  type ReplayEvent,
  type Station,
  type Threshold,
  type TimeWindow,
} from '@smmarchives/shared'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildReplay } from '../src/replay/build.ts'
import type { ReplayStore } from '../src/replay/store.ts'
import { AquasysClient } from '../src/sources/aquasys/client.ts'
import { closeDatabase } from './support/database.ts'
import { fetchStub, fixture } from './support/fixtures.ts'
import { aStoredReplay, cleanMedia } from './support/replay-store.ts'

const CONFIG = { baseUrl: 'https://api.test/api', token: 'jeton', timeZone: 'UTC' }

/**
 * Holds station 84 (2.8346, 43.0387) and rain gauge 4 (2.2955, 43.2153), and
 * none of the other fixtures: station 24 sits 1.5 km further south at 43.0149,
 * station 2 further east at 2.9459, and 152 and 737 are up in the Capcir.
 */
const NARBONNAIS: BoundingBox = { minLon: 2.25, minLat: 43.03, maxLon: 2.9, maxLat: 43.3 }

/** Every route the lane can reach, so an unexpected call fails loudly. */
const ROUTES = {
  '/hydrologicalStation/': { json: fixture('aquasys/stations.json') },
  '/hydrologicalStation/84': { json: fixture('aquasys/station-84-detail.json') },
  '/hydrologicalStation/84/threshold': { json: fixture('aquasys/thresholds-84.json') },
  '/hydrologicalStation/chronic/measures': { json: fixture('aquasys/measures-84-level.json') },
  '/pluviometer/': { json: fixture('aquasys/rain-gauges.json') },
  '/pluviometer/4': { json: fixture('aquasys/rain-gauge-4-detail.json') },
  '/pluviometer/chartMeasures': { json: fixture('aquasys/measures-84-level.json') },
}

let deliveries: string
/** The store the last `build()` wrote into, for the assertions that read it. */
let stored: ReplayStore

beforeEach(async () => {
  deliveries = await mkdtemp(join(tmpdir(), 'deliveries-'))
  const product = join(deliveries, '20044', 'pluvio5mn')
  await mkdir(product, { recursive: true })
  await writeFile(join(product, '1593102683.png'), 'x')
})

afterEach(async () => {
  await rm(deliveries, { recursive: true, force: true })
  await cleanMedia()
})

afterAll(closeDatabase)

type Overrides = {
  routes?: Parameters<typeof fetchStub>[0]
  extent?: BoundingBox | null
  period?: TimeWindow
  /** Wraps the real store, for the tests that need one of its writes to fail. */
  store?: (real: ReplayStore) => ReplayStore
  copyMedia?: boolean
  /** Omitted to build with one source only, which is what `--only` produces. */
  sources?: 'aquasys' | 'radar-rainfall' | 'both'
}

/* eslint-disable-next-line complexity -- a builder with one default per axis the suites vary,
   plus the ternaries that compose them */
async function build({
  routes = ROUTES,
  extent = NARBONNAIS,
  period = windowOf('2018-10-15T00:00:00Z', '2018-10-17T00:00:00Z'),
  store: wrap = (real) => real,
  copyMedia = false,
  sources = 'both',
}: Overrides = {}) {
  const { id, store: real } = await aStoredReplay({ label: null, extent, period })
  stored = real
  const fetch = fetchStub(routes)
  const result = await buildReplay({
    identity: { id, label: null, extent, period },
    store: wrap(real),
    ...(sources === 'radar-rainfall'
      ? {}
      : { aquasys: { client: new AquasysClient({ config: CONFIG, fetch }) } }),
    ...(sources === 'aquasys'
      ? {}
      : {
          radarRainfall: {
            root: deliveries,
            rasterExtent: DEFAULT_RADAR_RAINFALL_EXTENT,
            deliveries: undefined,
          },
        }),
    copyMedia,
  })
  return { ...result, calls: fetch.calls }
}

/**
 * What the replay holds, read back through the store that wrote it.
 *
 * Typed per data set: the mapping that reads them back gives each its own
 * shape, and a test asserting on the wrong one should not compile.
 */
async function heldReferential(): Promise<{ stations: Station[]; rainGauges: RainGauge[] }> {
  return (await stored.getDataset('stations')) as { stations: Station[]; rainGauges: RainGauge[] }
}

async function heldThresholds(): Promise<Threshold[]> {
  return (await stored.getDataset('thresholds')) as Threshold[]
}

async function heldMeasures(): Promise<Measure[]> {
  return (await stored.getDataset('measures')) as Measure[]
}

async function heldEvents(): Promise<ReplayEvent[]> {
  return (await stored.getDataset('events')) as ReplayEvent[]
}

describe('the Aquasys datasets of a replay', () => {
  it('are stored beside the ones the other lane produced', async () => {
    const { manifest } = await build()

    expect(Object.keys(manifest.datasets).sort()).toEqual([
      'events',
      'measures',
      'radar-rainfall',
      'stations',
      'thresholds',
    ])
    expect(manifest.state).toBe('complete')
  })

  it('keep the two families apart, as the two data-type tables require', async () => {
    await build()

    const referential = await heldReferential()
    expect(referential.stations.map((one: { id: number }) => one.id)).toEqual([84])
    expect(referential.rainGauges.map((one: { id: number }) => one.id)).toEqual([4])
  })

  it('carry the report of each collection, unchanged', async () => {
    const { manifest } = await build()

    expect(manifest.datasets['stations']?.report.script).toBe('fetch:aquasys:stations')
    expect(manifest.datasets['thresholds']?.report.script).toBe('fetch:aquasys:thresholds')
    expect(manifest.datasets['measures']?.report.script).toBe('fetch:aquasys:measures')
  })
})

/**
 * The reason the lane exists rather than three calls to the scripts: each script
 * loads a whole family referential to resolve its own identifiers, so running
 * three of them loads it three times — and nothing guarantees the three agree
 * on the fleet.
 */
describe('the referential a replay rests on', () => {
  it('is loaded once per family, not once per data set', async () => {
    const { calls } = await build()

    const lists = calls.filter((url) => url.endsWith('/hydrologicalStation/'))
    const gauges = calls.filter((url) => url.endsWith('/pluviometer/'))
    expect(lists).toHaveLength(1)
    expect(gauges).toHaveLength(1)
  })

  it('is the same fleet in the three data sets', async () => {
    await build()

    const referential = await heldReferential()
    const thresholds = await heldThresholds()
    const measures = await heldMeasures()

    const known = new Set<number>([
      ...referential.stations.map((one: { id: number }) => one.id),
      ...referential.rainGauges.map((one: { id: number }) => one.id),
    ])
    for (const one of thresholds) expect(known.has(one.stationId)).toBe(true)
    for (const one of measures) expect(known.has(one.sourceId)).toBe(true)
  })

  it('narrows on the extent before spending a call per source', async () => {
    const { calls } = await build()

    // 84 is inside the extent; 2 and 152 are not, 24 is out of scope, and none costs anything.
    expect(calls.filter((url) => /\/hydrologicalStation\/\d+$/.test(url))).toHaveLength(1)
    expect(calls.some((url) => url.includes('/hydrologicalStation/152'))).toBe(false)
  })
})

/**
 * The fleet of a replay is deduced from the measures, never from referential
 * dates, which are not reliable. The sources that answered nothing
 * are kept — an absence has to be explainable — and the manifest says how many
 * actually spoke.
 */
describe('the fleet of a replay', () => {
  it('says how many sources the extent held and how many returned measures', async () => {
    const { manifest } = await build()

    expect(manifest.fleet).toEqual({ inExtent: 2, withMeasures: 2 })
  })

  it('counts a silent source in the extent and not in the fleet', async () => {
    const { manifest } = await build({
      routes: { ...ROUTES, '/pluviometer/chartMeasures': { json: [] } },
    })

    expect(manifest.fleet).toEqual({ inExtent: 2, withMeasures: 1 })
  })
})

/**
 * The two families number their sources independently: `source-ids.ts` records
 * 94 stations spread over 1 to 160 and 229 rain gauges over 4 to 744, so an
 * identifier in that range names one of each. A station and a rain gauge are
 * two sources, whatever they are numbered.
 */
describe('a station and a rain gauge sharing an identifier', () => {
  it('count as two sources in the fleet', async () => {
    // The recorded referential with one identifier changed, since no pair of
    // fixtures collides today and the collision is what is under test.
    const stations = (fixture('aquasys/stations.json') as Array<Record<string, unknown>>).map(
      (row) => (row['id'] === 84 ? { ...row, id: 4 } : row),
    )

    const { manifest } = await build({
      routes: {
        ...ROUTES,
        '/hydrologicalStation/': { json: stations },
        '/hydrologicalStation/4': { json: fixture('aquasys/station-84-detail.json') },
        '/hydrologicalStation/4/threshold': { json: fixture('aquasys/thresholds-84.json') },
      },
    })

    expect(manifest.fleet).toEqual({ inExtent: 2, withMeasures: 2 })
  })
})

describe('a replay without an extent', () => {
  it('collects the whole fleet, which is the territory of the SMMAR', async () => {
    const { manifest } = await build({ extent: null })

    const referential = await heldReferential()
    expect(referential.stations).toHaveLength(3)
    expect(manifest.fleet?.inExtent).toBe(6)
  })
})

/**
 * A source is given or it is not; there is no flag saying which lanes to run
 * beside the sources they need. It is what lets a replay be built with no
 * network at all, and what will let one failed source be repaired alone.
 */
describe('a build given one source only', () => {
  it('runs that lane and leaves no trace of the other', async () => {
    const { manifest } = await build({ sources: 'aquasys' })

    // `events` too: it reads no source, so it runs on what the collection
    // returned rather than on a source being given.
    expect(Object.keys(manifest.lanes)).toEqual(['aquasys', 'events'])
    expect(Object.keys(manifest.datasets).sort()).toEqual([
      'events',
      'measures',
      'stations',
      'thresholds',
    ])
    expect(manifest.state).toBe('complete')
  })

  it('needs no Aquasys access to build a replay of the delivered rasters', async () => {
    const { manifest, exitCode } = await build({
      sources: 'radar-rainfall',
      period: windowOf('2020-06-25T00:00:00Z', '2020-06-26T00:00:00Z'),
    })

    expect(Object.keys(manifest.lanes)).toEqual(['radar-rainfall'])
    expect(manifest.state).toBe('complete')
    expect(exitCode).toBe(ExitCode.success)
  })
})

/**
 * A lane records its state before collecting anything, and that first write is
 * a disk write. Failing there leaves the lane with no terminal state and no
 * error to its name — which must not read as a replay that went fine.
 */
describe('a lane that dies before it starts collecting', () => {
  it('does not leave the replay complete', async () => {
    let writes = 0
    const { manifest, exitCode } = await build({
      store: (real) => ({
        ...real,
        putManifest: async (value) => {
          writes += 1
          if (writes === 3) throw new Error('ENOSPC: no space left on device')
          return real.putManifest(value)
        },
      }),
    })

    expect(manifest.state).not.toBe('complete')
    expect(exitCode).toBe(ExitCode.partial)
  })
})

describe('an Aquasys source that cannot be reached', () => {
  it('costs its own data sets and leaves the other lane whole', async () => {
    const { manifest, exitCode } = await build({
      routes: { '/hydrologicalStation/': { status: 500 }, '/pluviometer/': { status: 500 } },
    })

    expect(manifest.lanes['aquasys']).toMatchObject({ state: 'failed' })
    expect(manifest.lanes['radar-rainfall']).toMatchObject({ state: 'done' })
    expect(manifest.datasets['radar-rainfall']).toBeDefined()
    expect(manifest.datasets['stations']).toBeUndefined()
    expect(manifest.state).toBe('partial')
    expect(exitCode).toBe(ExitCode.partial)
  })

  /**
   * One threshold call, not the lane: `fetchThresholds` records a failure per
   * source and keeps going, so the lane reaches `done` with an incomplete data
   * set — which is a partial replay, not a failed one.
   */
  it('costs its own station when a single threshold call fails', async () => {
    const { manifest } = await build({
      routes: { ...ROUTES, '/hydrologicalStation/84/threshold': { status: 500 } },
    })

    expect(manifest.lanes['aquasys']).toMatchObject({ state: 'done' })
    expect(manifest.datasets['thresholds']?.report.failures).toMatchObject([
      { subject: 'source 84 thresholds' },
    ])
    expect(manifest.state).toBe('partial')
  })
})

/**
 * The lane stores three data sets in sequence. Something that stops it after
 * the first must leave that first one in place: the replay is then incomplete,
 * and re-running it will overwrite what it collects without losing the rest.
 */
describe('a lane that dies after storing one data set', () => {
  it('keeps what it had already stored', async () => {
    const { manifest, exitCode } = await build({
      sources: 'aquasys',
      store: (real) => ({
        ...real,
        putDataset: async (name, data) => {
          if (name === 'thresholds') throw new Error('EROFS: read-only file system')
          return real.putDataset(name, data)
        },
      }),
    })

    expect(manifest.datasets['stations']?.count).toBe(2)
    expect(manifest.datasets['thresholds']).toBeUndefined()
    expect(manifest.datasets['measures']).toBeUndefined()
    expect(manifest.lanes['aquasys']).toMatchObject({ state: 'failed' })
    expect(manifest.lanes['aquasys']?.error).toMatch(/EROFS/)
    expect(manifest.state).toBe('partial')
    expect(exitCode).toBe(ExitCode.partial)
    expect((await heldReferential()).stations).toHaveLength(1)
  })
})

describe('the media lane dying before it starts', () => {
  it('does not escape the build and leave the manifest mid-transition', async () => {
    let writes = 0
    const { manifest } = await build({
      sources: 'radar-rainfall',
      period: windowOf('2020-06-25T00:00:00Z', '2020-06-26T00:00:00Z'),
      copyMedia: true,
      store: (real) => ({
        ...real,
        putManifest: async (value) => {
          writes += 1
          // The write `begin('media')` performs, once the radar lane is done.
          if (writes === 5) throw new Error('ENOSPC: no space left on device')
          return real.putManifest(value)
        },
      }),
    })

    expect(manifest.state).not.toBe('running')
  })
})

/**
 * The derivation reads what the lane just collected, so it is proved here and
 * not only on the pure function: the recorded Berre series peaks at 3.604 m and
 * its ladder opens at 2.8, so a crossing exists in the fixtures themselves.
 */
describe('the facts a replay derives from its own data', () => {
  /* eslint-disable-next-line complexity -- the assertions read through optional chains, so an
     event the build did not derive fails on the value rather than on a throw */
  it('are stored beside the measures they come from', async () => {
    const { manifest } = await build()

    const events = await heldEvents()
    expect(events.length).toBeGreaterThan(0)
    // Found by what it is, never by its position: nothing promises the order
    // the data set is stored in.
    const vigilance = events.find((one) => one.crossing?.label === 'Vigilance')
    expect(vigilance).toMatchObject({
      origin: 'automatic',
      category: 'threshold-crossing',
      sourceId: 84,
    })
    // The recorded series crosses 2.8 and crests at 3.604: the two are not the
    // same number, and the event must not confuse them.
    expect(vigilance?.crossing?.value).toBe(2.8)
    expect(vigilance?.crossing?.measured).toBeLessThan(vigilance?.crossing?.peak ?? 0)
    expect(manifest.datasets['events']?.count).toBe(events.length)
  })

  it('are counted in the manifest, with the thresholds a nature set aside', async () => {
    const { manifest } = await build()

    expect(manifest.events?.crossings).toBe(manifest.datasets['events']?.count)
    // The Berre ladder carries historical flood marks and a drought scale.
    expect(manifest.events?.thresholdsSetAside['flood-mark']).toBeGreaterThan(0)
  })

  it('are absent from a replay built without the lane that derives them', async () => {
    const { manifest } = await build({ sources: 'radar-rainfall' })

    expect(manifest.datasets['events']).toBeUndefined()
    expect(manifest.events).toBeUndefined()
  })
})

/**
 * A derivation reads nothing over the network, so a bug in it must not condemn
 * the collection that fed it: three good data sets were already stored, and
 * their lane did not fail.
 */
describe('a derivation that throws', () => {
  it('fails its own lane and leaves the collection lane done', async () => {
    const { manifest, exitCode } = await build({
      sources: 'aquasys',
      store: (real) => ({
        ...real,
        putDataset: async (name, data) => {
          if (name === 'events') throw new Error('EROFS: read-only file system')
          return real.putDataset(name, data)
        },
      }),
    })

    expect(manifest.lanes['aquasys']).toMatchObject({ state: 'done' })
    expect(manifest.lanes['events']).toMatchObject({ state: 'failed' })
    expect(Object.keys(manifest.datasets).sort()).toEqual(['measures', 'stations', 'thresholds'])
    expect(manifest.state).toBe('partial')
    expect(exitCode).toBe(ExitCode.partial)
  })
})
