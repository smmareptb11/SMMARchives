import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_RADAR_RAINFALL_EXTENT,
  ReportCollector,
  exitCodeFor,
  windowOf,
} from '@smmarchives/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { indexDeliveries } from '../src/sources/radar-rainfall/indexer.ts'

/**
 * Delivery trees built on disk rather than the 2.7 GB archive: the shapes that
 * matter are the naming, the two cadences and the drifting production times.
 * One root per situation, since the index reads every delivery a root holds.
 */
let root: string
const COMPLETE = 'complete'
const EMPTY = 'empty'
const UNREADABLE = 'unreadable'

const FIVE_MINUTE_FRAMES = [1593102683, 1593103282, 1593103583, 1593103881]
const HOURLY_FRAMES = [1593102683, 1593106283, 1593109883]

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'radar-rainfall-'))

  for (const [product, epochs] of [
    ['pluvio5mn', FIVE_MINUTE_FRAMES],
    ['pluvio1h', FIVE_MINUTE_FRAMES],
    ['pluvio24h', HOURLY_FRAMES],
  ] as const) {
    const directory = join(root, COMPLETE, '20044', product)
    await mkdir(directory, { recursive: true })
    for (const epoch of epochs) await writeFile(join(directory, `${epoch}.png`), '')
  }

  await writeFile(join(root, COMPLETE, '20044', 'pluvio5mn', 'legende.txt'), '')
  await mkdir(join(root, EMPTY, '20039', 'pluvio5mn'), { recursive: true })

  await mkdir(join(root, UNREADABLE, '20040', 'pluvio5mn'), { recursive: true })
  await writeFile(join(root, UNREADABLE, '20040', 'pluvio5mn', '1593102683.png'), '')
  await mkdir(join(root, UNREADABLE, '20040', 'pluvio1h'), { recursive: true })
  await chmod(join(root, UNREADABLE, '20040', 'pluvio1h'), 0o000)
})

afterAll(async () => {
  await chmod(join(root, UNREADABLE, '20040', 'pluvio1h'), 0o755).catch(() => {})
  await rm(root, { recursive: true, force: true })
})

/** The day every frame of the trees falls in. */
const THE_DAY = windowOf('2020-06-25T00:00:00Z', '2020-06-26T00:00:00Z')

function index(tree: string, overrides: Partial<Parameters<typeof indexDeliveries>[0]> = {}) {
  const collector = new ReportCollector({})
  return indexDeliveries({
    root: join(root, tree),
    extent: DEFAULT_RADAR_RAINFALL_EXTENT,
    collector,
    window: THE_DAY,
    ...overrides,
  }).then((result) => ({ ...result, report: collector.seal() }))
}

describe('what a delivery contains', () => {
  it('reads the products off the directory instead of a list in the code', async () => {
    const { series } = await index(COMPLETE)

    expect(series.map((one) => one.product).sort()).toEqual(['pluvio1h', 'pluvio24h', 'pluvio5mn'])
  })

  it('turns epoch seconds in the filename into instants on the single clock', async () => {
    const { series } = await index(COMPLETE)
    const frames = series.find((one) => one.product === 'pluvio5mn')?.frames

    expect(frames?.[0]).toEqual({
      at: '2020-06-25T16:31:23.000Z',
      path: '20044/pluvio5mn/1593102683.png',
    })
  })

  it('sorts frames so the consumer can look for a nearest neighbour', async () => {
    const { series } = await index(COMPLETE)
    const instants = series.find((one) => one.product === 'pluvio5mn')?.frames.map((f) => f.at)

    expect(instants).toEqual([...(instants ?? [])].sort())
  })

  it('measures the two cadences rather than assuming either', async () => {
    const { series } = await index(COMPLETE)

    expect(series.find((one) => one.product === 'pluvio5mn')?.medianStepMinutes).toBe(5)
    expect(series.find((one) => one.product === 'pluvio24h')?.medianStepMinutes).toBe(60)
  })

  it('skips an entry that is not <epoch>.png rather than guessing at it', async () => {
    const { skipped } = await index(COMPLETE)
    expect(skipped).toBe(1)
  })

  it('records the coverage of each series, which no frame carries', async () => {
    const { series } = await index(COMPLETE)
    const fiveMinute = series.find((one) => one.product === 'pluvio5mn')

    expect(fiveMinute?.frames.at(0)?.at).toBe('2020-06-25T16:31:23.000Z')
    expect(fiveMinute?.frames.at(-1)?.at).toBe('2020-06-25T16:51:21.000Z')
  })
})

describe('a period no delivery covers', () => {
  it('is an absence, not a failure', async () => {
    const { series, report } = await index(COMPLETE, {
      window: windowOf('2018-10-15T00:00:00Z', '2018-10-16T00:00:00Z'),
    })

    expect(series).toEqual([])
    expect(report.failures).toEqual([])
    expect(exitCodeFor(report)).toBe(0)
  })

  it('reports an empty delivery directory without inventing products', async () => {
    const { series, report } = await index(EMPTY)

    expect(series).toEqual([])
    expect(report.sourcesWithoutData).toEqual(['20039/pluvio5mn'])
  })
})

describe('an unreadable root', () => {
  it('is a failure, unlike a root with nothing in it', async () => {
    await expect(index('nowhere')).rejects.toThrow(/ENOENT/)
  })
})

describe('an unreadable product inside a readable delivery', () => {
  /** Root permissions are a configuration problem; one product is not. */
  it.skipIf(process.getuid?.() === 0)('is partial, and what was indexed is kept', async () => {
    const { series, report } = await index(UNREADABLE)

    expect(series.map((one) => one.product)).toEqual(['pluvio5mn'])
    expect(report.failures).toMatchObject([{ subject: '20040/pluvio1h' }])
    expect(exitCodeFor(report)).toBe(2)
  })
})

describe('cropping to a window', () => {
  it('keeps only the frames inside it', async () => {
    const { series } = await index(COMPLETE, {
      window: windowOf('2020-06-25T16:40:00Z', '2020-06-25T16:50:00Z'),
    })

    expect(series.find((one) => one.product === 'pluvio5mn')?.frames.map((f) => f.at)).toEqual([
      '2020-06-25T16:41:22.000Z',
      '2020-06-25T16:46:23.000Z',
    ])
  })
})
