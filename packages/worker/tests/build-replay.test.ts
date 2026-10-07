import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_RADAR_RAINFALL_EXTENT,
  ExitCode,
  windowOf,
  type DatasetName,
  type RadarRainfallSeries,
  type Report,
} from '@smmarchives/shared'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildReplay } from '../src/replay/build.ts'
import { AquasysClient } from '../src/sources/aquasys/client.ts'
import { closeDatabase } from './support/database.ts'
import { fetchStub } from './support/fixtures.ts'
import {
  aStoredReplay,
  cleanMedia,
  frozenBytes,
  type StoredReplay,
} from './support/replay-store.ts'

/**
 * These tests are about the radar lane. Aquasys answers an empty fleet so its
 * lane succeeds collecting nothing, which keeps the manifest's state a
 * statement about the lane under test.
 */
function emptyFleet() {
  return {
    client: new AquasysClient({
      config: { baseUrl: 'https://api.test/api', token: 'jeton', timeZone: 'UTC' },
      fetch: fetchStub({ '/hydrologicalStation/': { json: [] }, '/pluviometer/': { json: [] } }),
    }),
  }
}

/** Two products of one delivery, four frames apiece, as a delivery is laid out. */
const FRAMES = [1593102683, 1593103282, 1593103583, 1593103881]

let deliveries: string
/** The replay the builds of one test write into, so a re-run finds the first. */
let replay: StoredReplay | undefined

beforeEach(async () => {
  replay = undefined
  deliveries = await mkdtemp(join(tmpdir(), 'deliveries-'))

  for (const product of ['pluvio5mn', 'pluvio1h']) {
    const directory = join(deliveries, '20044', product)
    await mkdir(directory, { recursive: true })
    for (const epoch of FRAMES) await writeFile(join(directory, `${epoch}.png`), `${epoch}`)
  }
})

afterEach(async () => {
  await rm(deliveries, { recursive: true, force: true })
  await cleanMedia()
})

afterAll(closeDatabase)

type Options = Parameters<typeof buildReplay>[0]

const IDENTITY = {
  label: null,
  extent: null,
  period: windowOf('2020-06-25T00:00:00Z', '2020-06-26T00:00:00Z'),
}

/** Only the two nested objects merge; the rest is replaced outright. */
type Overrides = Partial<Omit<Options, 'identity' | 'radarRainfall'>> & {
  identity?: Partial<Options['identity']>
  radarRainfall?: Partial<Options['radarRainfall']>
}

/** Merges one level down, so a test changing one field retypes no other. */
async function build(overrides: Overrides = {}) {
  replay ??= await aStoredReplay(IDENTITY)
  return buildReplay({
    ...{ copyMedia: true, store: replay.store, aquasys: emptyFleet() },
    ...overrides,
    identity: {
      id: replay.id,
      ...IDENTITY,
      ...overrides.identity,
    },
    radarRainfall: {
      root: deliveries,
      extent: DEFAULT_RADAR_RAINFALL_EXTENT,
      ...overrides.radarRainfall,
    },
  })
}

/** What the replay holds, read back through the store that wrote it. */
function stored(): StoredReplay {
  if (replay === undefined) throw new Error('nothing was built yet')
  return replay
}

describe('a replay that builds', () => {
  it('writes a manifest saying what it holds', async () => {
    const { manifest } = await build()

    expect(manifest.state).toBe('complete')
    expect(manifest.datasets['radar-rainfall']).toMatchObject({ count: 2 })
    expect((await stored().store.getManifest())?.state).toBe('complete')
  })

  it('stores the index the interface will read', async () => {
    await build()

    const series = (await stored().store.getDataset('radar-rainfall')) as RadarRainfallSeries[]
    expect(series.map((one: { product: string }) => one.product).sort()).toEqual([
      'pluvio1h',
      'pluvio5mn',
    ])
  })

  it('keeps the collection report, which the data set cannot show', async () => {
    await mkdir(join(deliveries, '20036'))
    const { manifest } = await build()

    expect(manifest.datasets['radar-rainfall']?.report.sourcesWithoutData).toEqual(['20036'])
  })

  it('leaves a journal of what happened, for the administration to show', async () => {
    await build()

    const kinds = (await stored().store.readJournal(0)).map((entry) => entry.kind)
    expect(kinds[0]).toBe('started')
    expect(kinds.at(-1)).toBe('done')
  })

  it('succeeds with an exit code of its own', async () => {
    const { exitCode } = await build()
    expect(exitCode).toBe(ExitCode.success)
  })
})

/**
 * A reader does not wait for the build: the API answers a creation by reading
 * the replay a few seconds in, whatever the build is doing at that moment.
 */
describe('a replay read while it is being built', () => {
  it('is readable after every data set the build stores', async () => {
    replay = await aStoredReplay(IDENTITY)
    const real = replay.store
    const stored: [DatasetName, Report][] = []
    const read: [DatasetName, unknown][] = []

    await build({
      store: {
        ...real,
        putDataset: async (name, data, report) => {
          await real.putDataset(name, data, report)
          stored.push([name, report])
          read.push([
            name,
            await real.getManifest().then(
              (manifest) => manifest?.datasets[name]?.report,
              (error: Error) => error.name,
            ),
          ])
        },
      },
    })

    expect(stored).not.toHaveLength(0)
    expect(read).toEqual(stored)
  })
})

describe('the media of a replay', () => {
  it('are copied under it, so the replay survives the deliveries moving', async () => {
    const { manifest } = await build()

    expect(
      (await frozenBytes(stored().store, 'radar/20044/pluvio5mn/1593102683.png'))?.toString('utf8'),
    ).toBe('1593102683')
    expect(manifest.media.copied).toBe(FRAMES.length * 2)
  })

  it('are not fetched again by a second run', async () => {
    await build()
    const { manifest } = await build()

    expect(manifest.media.copied).toBe(0)
    expect(manifest.media.skipped).toBe(FRAMES.length * 2)
  })

  it('are left alone when the run asks for no media', async () => {
    const { manifest } = await build({ copyMedia: false })

    expect(manifest.media.copied).toBe(0)
    expect(existsSync(join(stored().mediaRoot, stored().id))).toBe(false)
  })
})

describe('a period no delivery covers', () => {
  it('is an absence, not a failure', async () => {
    const { manifest, exitCode } = await build({
      identity: { period: windowOf('2018-10-15T00:00:00Z', '2018-10-16T00:00:00Z') },
    })

    expect(manifest.state).toBe('complete')
    expect(exitCode).toBe(ExitCode.success)
    expect(await stored().store.getDataset('radar-rainfall')).toEqual([])
  })
})

describe('a collection where some of it failed', () => {
  /** Root reads everything, so the permission this rests on would not apply. */
  it.skipIf(process.getuid?.() === 0)(
    'stores what it got and says the replay is incomplete',
    async () => {
      await chmod(join(deliveries, '20044', 'pluvio1h'), 0o000)
      try {
        const { manifest, exitCode } = await build()

        expect(manifest.datasets['radar-rainfall']?.count).toBe(1)
        expect(manifest.datasets['radar-rainfall']?.report.failures).toMatchObject([
          { subject: '20044/pluvio1h' },
        ])
        expect(manifest.state).toBe('partial')
        expect(exitCode).toBe(ExitCode.partial)
      } finally {
        await chmod(join(deliveries, '20044', 'pluvio1h'), 0o755)
      }
    },
  )
})

describe('a medium that cannot be read', () => {
  it.skipIf(process.getuid?.() === 0)('costs its own frame, not the replay', async () => {
    const frame = join(deliveries, '20044', 'pluvio5mn', `${FRAMES[0]}.png`)
    await chmod(frame, 0o000)
    try {
      const { manifest, exitCode } = await build()

      expect(manifest.media.failed).toBe(1)
      expect(manifest.media.copied).toBe(FRAMES.length * 2 - 1)
      expect(manifest.state).toBe('partial')
      expect(exitCode).toBe(ExitCode.partial)
    } finally {
      await chmod(frame, 0o644)
    }
  })

  it.skipIf(process.getuid?.() === 0)(
    'says which one, in the journal that has no data set to carry it',
    async () => {
      const frame = join(deliveries, '20044', 'pluvio5mn', `${FRAMES[0]}.png`)
      await chmod(frame, 0o000)
      try {
        await build()
        expect(JSON.stringify(await stored().store.readJournal(0))).toContain(
          `media 20044/pluvio5mn/${FRAMES[0]}.png`,
        )
      } finally {
        await chmod(frame, 0o644)
      }
    },
  )
})

/**
 * The journal is a trace, not the replay. Losing it must not turn a stored
 * replay into an exit code documented as "could not start", which would leave
 * the manifest on disk saying `complete` and the command saying the opposite.
 */
describe('a journal that could not be written', () => {
  it('makes the replay incomplete rather than failing the command', async () => {
    const opened = await aStoredReplay(IDENTITY)
    replay = opened
    const { manifest, exitCode } = await build({
      store: {
        ...opened.store,
        appendJournal: async () => {
          throw new Error('ENOSPC: no space left on device')
        },
      },
      copyMedia: false,
    })

    expect(manifest.state).toBe('partial')
    expect(manifest.journalError).toMatch(/ENOSPC/)
    expect(exitCode).toBe(ExitCode.partial)
    expect((await stored().store.getManifest())?.state).toBe('partial')
  })
})

/**
 * The contracts of `contracts/` were inert once — sixteen schemas, eleven never
 * parsed — and a longitude of 1000 reached production through one of them. The
 * manifest is the index the API will serve: a bound that never runs on it is
 * the same defect again.
 */
describe('a manifest its own contract refuses', () => {
  it('is never stored', async () => {
    await expect(build({ identity: { id: 'Aude 2018' }, copyMedia: false })).rejects.toThrow(/id/)

    // The replay exists — its row is what a build is given — but nothing it
    // would hold was ever published under a manifest its contract refuses.
    expect((await stored().store.getManifest())?.datasets).toEqual({})
  })
})

describe('a lane that cannot run', () => {
  it('leaves the replay stored and incomplete rather than nothing at all', async () => {
    const { manifest, exitCode } = await build({
      radarRainfall: { root: join(deliveries, 'nowhere') },
    })

    expect(manifest.lanes['radar-rainfall']).toMatchObject({ state: 'failed' })
    expect(manifest.lanes['radar-rainfall']?.error).toMatch(/ENOENT/)
    expect(manifest.state).toBe('partial')
    expect(exitCode).toBe(ExitCode.partial)
    expect((await stored().store.getManifest())?.state).toBe('partial')
  })

  /** `failed` is what is left when no lane stored anything at all. */
  it('makes the replay failed only when nothing was stored', async () => {
    const { manifest, exitCode } = await build({
      radarRainfall: { root: join(deliveries, 'nowhere') },
      aquasys: {
        client: new AquasysClient({
          config: { baseUrl: 'https://api.test/api', token: 'jeton', timeZone: 'UTC' },
          fetch: fetchStub({ '/hydrologicalStation/': { status: 500 } }),
        }),
      },
    })

    expect(manifest.datasets).toEqual({})
    expect(manifest.state).toBe('failed')
    expect(exitCode).toBe(ExitCode.partial)
  })
})
