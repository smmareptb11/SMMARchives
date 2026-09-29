import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_RADAR_RAINFALL_EXTENT,
  ExitCode,
  windowOf,
  type BoundingBox,
  type FrozenWebcamImage,
  type ReferenceLayer,
  type TimeWindow,
  type Webcam,
} from '@smmarchives/shared'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildReplay } from '../src/replay/build.ts'
import type { ReplayStore } from '../src/replay/store.ts'
import { closeDatabase } from './support/database.ts'
import {
  aStoredReplay,
  cleanMedia,
  frozenBytes,
  type StoredReplay,
} from './support/replay-store.ts'
import { LizmapClient } from '../src/sources/lizmap/client.ts'
import { fetchStub, fixture, fixtureText } from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://crise.test' }

/**
 * The fixture's three pictures span 2026-09-08 12:03 to 2026-09-09 12:03, so
 * this window holds all three and stays inside Ceneau's one-month retention.
 */
const RECENT: TimeWindow = windowOf('2026-09-08T00:00:00Z', '2026-09-10T00:00:00Z')

/**
 * Holds the Mailhac camera (2.8278, 43.3031) and no other of the fixture: Pezens
 * and Villegailhenc sit west of 2.4, Sallèles at 2.9459 and Narbonne at 43.1756.
 */
const MAILHAC: BoundingBox = { minLon: 2.5, minLat: 43.28, maxLon: 2.9, maxLat: 43.35 }

const IMAGES = fixture('ceneau/images-215.json') as {
  pictures: Array<{ uri: string; thumb_uri: string }>
}

/** 2026-09-09T06:00:00Z, inside {@link RECENT}. */
const RASTER_EPOCH = 1788933600

const ROUTES = {
  'TYPENAME=webcam': { json: fixture('lizmap/webcam.json') },
  'TYPENAME=ouvrage_hydraulique': { json: fixture('lizmap/ouvrage_hydraulique.json') },
  'TYPENAME=perimetre_smmar': { json: fixture('lizmap/ouvrage_hydraulique.json') },
  'TYPENAME=perimetre_syndicats': { json: fixture('lizmap/ouvrage_hydraulique.json') },
  'TYPENAME=bd_admin_commune': { json: fixture('lizmap/ouvrage_hydraulique.json') },
  Ceneau_img_215: { json: fixture('ceneau/images-215.json') },
  'media.ceneau.test': { text: 'JPEG' },
}

/**
 * The replay the builds of one test write into.
 *
 * Kept across two builds on purpose: what a re-run preserves is only visible
 * when the second run finds what the first stored.
 */
let replay: StoredReplay | undefined
let deliveries: string

beforeEach(async () => {
  replay = undefined
  deliveries = await mkdtemp(join(tmpdir(), 'deliveries-'))
  const product = join(deliveries, '20044', 'pluvio5mn')
  await mkdir(product, { recursive: true })
  // Dated inside RECENT, so a build over that window has one raster to freeze
  // alongside the pictures — the two media producers at once.
  await writeFile(join(product, `${RASTER_EPOCH}.png`), 'x')
})

afterEach(async () => {
  await cleanMedia()
  await rm(deliveries, { recursive: true, force: true })
})

type Overrides = {
  routes?: Parameters<typeof fetchStub>[0]
  extent?: BoundingBox | null
  period?: TimeWindow
  store?: (real: ReplayStore) => ReplayStore
  withRadar?: boolean
  copyMedia?: boolean
}

/* eslint-disable-next-line complexity -- a builder with one default per axis the suites vary,
   plus the ternaries that compose them */
async function build({
  routes = ROUTES,
  extent = MAILHAC,
  period = RECENT,
  store: wrap = (real) => real,
  withRadar = false,
  copyMedia = true,
}: Overrides = {}) {
  replay ??= await aStoredReplay({ label: null, extent, period })
  const fetch = fetchStub(routes)
  const result = await buildReplay({
    identity: { id: replay.id, label: null, extent, period },
    store: wrap(replay.store),
    lizmap: { client: new LizmapClient({ config: CONFIG, fetch, minIntervalMs: 0 }), fetch },
    ...(withRadar
      ? {
          radarRainfall: {
            root: deliveries,
            rasterExtent: DEFAULT_RADAR_RAINFALL_EXTENT,
            deliveries: undefined,
          },
        }
      : {}),
    copyMedia,
  })
  return { ...result, calls: fetch.calls }
}

/** What the replay holds, read back through the store that wrote it. */
async function held<T>(name: Parameters<typeof stored>[0]): Promise<T> {
  return (await stored(name)) as T
}

function stored(name: 'reference-layers' | 'webcams' | 'webcam-images'): Promise<unknown> {
  if (replay === undefined) throw new Error('nothing was built yet')
  return replay.store.getDataset(name)
}

/** The bytes of a frozen image, or undefined when the replay never froze it. */
async function frozen(path: string): Promise<string | undefined> {
  if (replay === undefined) throw new Error('nothing was built yet')
  return (await frozenBytes(replay.store, path))?.toString('utf8')
}

/** Forgets the replay, so the next build starts on an empty one. */
function startOver(): void {
  replay = undefined
}

describe('the Lizmap data sets of a replay', () => {
  it('are the reference layers, the cameras and their image lists', async () => {
    const { manifest } = await build()

    expect(Object.keys(manifest.datasets).sort()).toEqual([
      'reference-layers',
      'webcam-images',
      'webcams',
    ])
    expect(manifest.state).toBe('complete')
  })

  it('freeze the four reference layers whole, since they are the extent referential', async () => {
    const { calls } = await build()

    // Asked for by name, and each actually requested: the stored `name` is the
    // one the lane asked for, so reading it back would only echo the enum.
    for (const layer of [
      'ouvrage_hydraulique',
      'perimetre_smmar',
      'perimetre_syndicats',
      'bd_admin_commune',
    ]) {
      expect(calls.filter((url) => url.includes(`TYPENAME=${layer}`))).toHaveLength(1)
    }

    const layers = await held<ReferenceLayer[]>('reference-layers')
    expect(layers).toHaveLength(4)
    // Whole, not narrowed: every feature the layer holds is in the replay.
    for (const layer of layers) {
      expect(layer.featureCount).toBeGreaterThan(0)
      expect(layer.geojson.features).toHaveLength(layer.featureCount)
    }
    expect(calls.some((url) => url.includes('BBOX'))).toBe(false)
  })

  it('keep only the cameras that have an archive', async () => {
    await build({ extent: null })

    const webcams = await held<Webcam[]>('webcams')
    expect(webcams.map((one: { code: string }) => one.code).sort()).toEqual([
      '215',
      '550',
      '564',
      '606',
      '649',
    ])
  })

  it('narrow the cameras on the extent before asking for any image list', async () => {
    const { calls } = await build()

    expect(calls.filter((url) => url.includes('Ceneau_img_215'))).toHaveLength(1)
    expect(calls.some((url) => url.includes('Ceneau_img_649'))).toBe(false)
  })

  it('carry the report of the script that produced them, and nothing else', async () => {
    const [first] = IMAGES.pictures
    const { manifest } = await build({ routes: { ...ROUTES, [first!.uri]: { status: 404 } } })

    expect(manifest.datasets['reference-layers']?.report.script).toBe('fetch:lizmap:layers')
    expect(manifest.datasets['webcams']?.report.script).toBe('fetch:webcams:positions')
    expect(manifest.datasets['webcam-images']?.report.script).toBe('fetch:webcams:images')

    // A download failure is not the script's: `fetch:webcams:images` downloads
    // nothing, so attributing it there would send a reader to a command that
    // cannot reproduce it.
    expect(manifest.datasets['webcam-images']?.report.failures).toEqual([])
  })
})

describe('the crisis Lizmap a replay reads', () => {
  it('is read without opening the project view', async () => {
    const { calls } = await build()

    expect(calls.some((url) => url.includes('/index.php/view/map'))).toBe(false)
  })
})

/**
 * The freeze exists for this: the images live at `media.ceneau.test` with a
 * one-month retention, so a replay that kept only their URLs would empty itself
 * without warning.
 */
describe('the webcam images of a replay', () => {
  // Every picture of the fixture carries a `thumb_uri`, and both files land on
  // the volume: the tally counts what the replay holds, not what it observed.
  const FILES = IMAGES.pictures.length * 2

  it('are copied under it, and the data set points at the copy', async () => {
    const { manifest } = await build()

    const images = await held<FrozenWebcamImage[]>('webcam-images')
    expect(images).toHaveLength(IMAGES.pictures.length)
    for (const image of images) {
      expect(image.storedPath).toMatch(/^webcams\/215\/\d+\.jpg$/)
      expect(await frozen(image.storedPath ?? '')).toBe('JPEG')
    }
    expect(manifest.media.copied).toBe(FILES)
  })

  /**
   * A lane drawn from the full images fetches some six hundred kilobytes a view
   * to paint eighty pixels; Ceneau's own reduction is four. It is frozen beside
   * the picture, under the camera it belongs to, so the strip is cheap and the
   * full image stays one hover away.
   */
  it('are frozen with the reduction Ceneau publishes beside them', async () => {
    await build()

    const images = await held<FrozenWebcamImage[]>('webcam-images')
    for (const image of images) {
      expect(image.storedThumbPath).toMatch(/^webcams\/215\/thumbs\/\d+\.jpg$/)
      expect(await frozen(image.storedThumbPath ?? '')).toBe('JPEG')
    }
  })

  /**
   * A reduction is an economy, never the observation. One that cannot be had
   * leaves the picture — and the replay — whole: the lane draws the full image
   * instead, and the report says how many views pay that price.
   */
  it('keep the picture when only its reduction cannot be fetched', async () => {
    const [first] = IMAGES.pictures
    const { manifest, exitCode } = await build({
      routes: { ...ROUTES, [first!.thumb_uri]: { status: 404 } },
    })

    const images = await held<FrozenWebcamImage[]>('webcam-images')
    expect(images.filter((one) => one.storedThumbPath === null)).toHaveLength(1)
    expect(images.every((one) => one.storedPath !== null)).toBe(true)
    expect(manifest.media.failed).toBe(0)
    expect(manifest.state).toBe('complete')
    expect(exitCode).toBe(ExitCode.success)
    expect(manifest.datasets['webcam-images']?.report.fallbacks).toContainEqual(
      expect.objectContaining({ subject: 'webcams thumbnails' }),
    )
  })

  /**
   * `thumb_uri` reaches the freeze as a plain string: the listing checks that
   * it is one and nothing more. A relative one used to throw out of the
   * download, reject the batch, and cost the replay every camera it holds —
   * for one malformed reduction.
   */
  it('keep every camera when a reduction has an address that is not one', async () => {
    const [first, ...rest] = IMAGES.pictures
    const listing = {
      ...IMAGES,
      pictures: [{ ...first!, thumb_uri: '/thumbs/relative.jpg' }, ...rest],
    }
    const { manifest, exitCode } = await build({
      routes: { ...ROUTES, Ceneau_img_215: { json: listing } },
    })

    const images = await held<FrozenWebcamImage[]>('webcam-images')
    expect(images).toHaveLength(IMAGES.pictures.length)
    expect(images.every((one) => one.storedPath !== null)).toBe(true)
    expect(images.filter((one) => one.storedThumbPath === null)).toHaveLength(1)
    expect(manifest.state).toBe('complete')
    expect(exitCode).toBe(ExitCode.success)
    expect(manifest.datasets['webcam-images']?.report.fallbacks).toContainEqual(
      expect.objectContaining({ subject: 'webcam 215 thumbnails' }),
    )
  })

  /**
   * The same guard covers the store, where a full volume ends up. Reported as
   * a camera publishing no reduction, it would send someone looking at Ceneau.
   */
  it('say why a reduction is missing, and not only how many are', async () => {
    const [first] = IMAGES.pictures
    const { manifest } = await build({
      routes: { ...ROUTES, [first!.thumb_uri]: { status: 404 } },
    })

    const fallback = manifest.datasets['webcam-images']?.report.fallbacks.find(
      (one) => one.subject === 'webcams thumbnails',
    )
    expect(fallback?.applied).toContain(`1 of ${String(IMAGES.pictures.length)}`)
    expect(fallback?.applied).toMatch(/404/)
  })

  it('are not fetched again by a second run', async () => {
    await build()
    const { manifest, calls } = await build()

    expect(manifest.media.copied).toBe(0)
    expect(manifest.media.skipped).toBe(FILES)
    expect(calls.some((url) => url.includes('media.ceneau.test'))).toBe(false)
  })

  it('cost their own image when one cannot be fetched, not the replay', async () => {
    const [first] = IMAGES.pictures
    const { manifest, exitCode } = await build({
      routes: { ...ROUTES, [first!.uri]: { status: 404 } },
    })

    const images = await held<FrozenWebcamImage[]>('webcam-images')
    expect(
      images.filter((one: { storedPath: string | null }) => one.storedPath === null),
    ).toHaveLength(1)
    expect(manifest.media.failed).toBe(1)
    expect(manifest.media.copied).toBe(FILES - 1)
    expect(manifest.state).toBe('partial')
    expect(exitCode).toBe(ExitCode.partial)
  })
})

/**
 * A replay of 2018 predates the retention by years. The absence is expected, it
 * is reported, and it is not a failure — the exit code stays 0.
 */
describe('a period older than what Ceneau keeps', () => {
  /**
   * The emptiness itself comes from cropping to the window; what the retention
   * adds is the reason, and `beyondRetention` is the only thing that carries
   * it. Without it a reader cannot tell an expected absence from a defect.
   */
  it('reports the retention as the reason, and is still a success', async () => {
    const { manifest, exitCode } = await build({
      period: windowOf('2018-10-15T00:00:00Z', '2018-10-16T00:00:00Z'),
    })

    expect(await held<FrozenWebcamImage[]>('webcam-images')).toEqual([])
    expect(manifest.datasets['webcam-images']?.report['beyondRetention']).toBe(true)
    expect(manifest.media.copied).toBe(0)
    expect(exitCode).toBe(ExitCode.success)
    expect(existsSync(join(replay?.mediaRoot ?? '', replay?.id ?? ''))).toBe(false)
  })
})

describe('a Lizmap that cannot be reached', () => {
  it('costs its own data sets and leaves the other lane whole', async () => {
    const { manifest, exitCode } = await build({
      routes: { '/index.php/lizmap/service/': { status: 503 } },
      withRadar: true,
    })

    expect(manifest.lanes['lizmap']).toMatchObject({ state: 'failed' })
    expect(manifest.lanes['radar-rainfall']).toMatchObject({ state: 'done' })
    expect(manifest.datasets['radar-rainfall']).toBeDefined()
    expect(manifest.state).toBe('partial')
    expect(exitCode).toBe(ExitCode.partial)
  })

  /** A layer that refuses is one layer, not the lane. */
  it('keeps the layers that answered when one refuses', async () => {
    const { manifest } = await build({
      routes: {
        ...ROUTES,
        'TYPENAME=bd_admin_commune': { text: fixtureText('lizmap/forbidden.xml') },
      },
    })

    expect(manifest.datasets['reference-layers']?.count).toBe(3)
    expect(manifest.datasets['reference-layers']?.report.failures).toHaveLength(1)
    expect(manifest.state).toBe('partial')
  })
})

/**
 * The freeze exists because Ceneau purges after a month. A re-run recollects
 * the listing from a source that has since forgotten those images, so the index
 * must not be replaced by the shorter one: that would drop the layer the freeze
 * had already saved, leaving the JPEGs on disk with nothing pointing at them.
 */
describe('a re-run once Ceneau has purged the images', () => {
  it('keeps the images it had already frozen', async () => {
    await build()
    const { manifest } = await build({
      routes: { ...ROUTES, Ceneau_img_215: { json: { pictures: [] } } },
    })

    const images = await held<FrozenWebcamImage[]>('webcam-images')
    expect(images).toHaveLength(IMAGES.pictures.length)
    for (const image of images) {
      expect(await frozen(image.storedPath ?? '')).toBe('JPEG')
    }
    expect(manifest.datasets['webcam-images']?.report.fallbacks).toMatchObject([
      { subject: 'webcam 215' },
    ])
  })
})

/**
 * Two lanes freeze media now. The tally answers one question for the replay —
 * how much it holds — so it accumulates instead of being replaced by whichever
 * lane published last.
 */
describe('a replay whose two lanes both freeze media', () => {
  it('counts what both of them copied', async () => {
    const { manifest } = await build({ withRadar: true })

    // One raster in the delivery tree, and three pictures in the listing, each
    // frozen with the reduction Ceneau publishes beside it.
    expect(manifest.media.copied).toBe(IMAGES.pictures.length * 2 + 1)
    expect(manifest.datasets['radar-rainfall']).toBeDefined()
    expect(manifest.datasets['webcam-images']).toBeDefined()
    expect(manifest.state).toBe('complete')
  })
})

describe('a run asked for no media', () => {
  it('lists the images without copying any, and says it holds none', async () => {
    const { manifest, calls } = await build({ copyMedia: false })

    const images = await held<FrozenWebcamImage[]>('webcam-images')
    expect(images).toHaveLength(IMAGES.pictures.length)
    expect(images.every((one: { storedPath: string | null }) => one.storedPath === null)).toBe(true)
    expect(images.every((one) => one.storedThumbPath === null)).toBe(true)
    expect(calls.some((url) => url.includes('media.ceneau.test'))).toBe(false)
    expect(manifest.media).toEqual({ copied: 0, skipped: 0, failed: 0, bytes: 0 })
  })

  it('leaves the images in the order the listing gave them, as a copying run does', async () => {
    await build({ copyMedia: false })
    const without = await held<FrozenWebcamImage[]>('webcam-images')
    startOver()
    await build()
    const withMedia = await held<FrozenWebcamImage[]>('webcam-images')

    expect(withMedia.map((one: { at: string }) => one.at)).toEqual(
      without.map((one: { at: string }) => one.at),
    )
  })
})

afterAll(closeDatabase)
