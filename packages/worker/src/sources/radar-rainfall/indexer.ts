import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  cropToWindow,
  fromEpochSeconds,
  medianStepMinutes,
  type BoundingBox,
  type RadarRainfallFrame,
  type RadarRainfallSeries,
  type ReportCollector,
  type TimeWindow,
} from '@smmarchives/shared'

/** `<epoch in seconds>.png`, the only filename shape a delivery uses. */
const FRAME_FILENAME = /^(\d+)\.png$/

export type IndexOptions = {
  root: string
  extent: BoundingBox
  collector: ReportCollector
  window: TimeWindow
}

export type IndexResult = {
  series: RadarRainfallSeries[]
  /** Entries that are not `<epoch>.png`; skipped rather than guessed at. */
  skipped: number
}

/**
 * Indexes the delivered radar rainfall images on disk.
 *
 * There is no live history to fetch: `last.png` is the only file the producer
 * exposes and it carries no date, not even a `Last-Modified`. The history
 * arrives as deliveries dropped in a directory, which is what this reads.
 *
 * Filenames are production times, not slots — observed steps run from 3.9 to 10
 * minutes and products do not share timestamps — so nothing here computes a
 * filename from a target time. It indexes what exists, sorted, and the consumer
 * looks for the nearest neighbour.
 */
/* eslint-disable-next-line max-statements -- one pass per delivery and per product, an unreadable
   one costing itself alone */
export async function indexDeliveries(options: IndexOptions): Promise<IndexResult> {
  // An unreadable root is a configuration failure, and the only one here: a root
  // holding no delivery is not, since deliveries exist only for the periods SMMAR
  // has published. Anything unreadable deeper down is a partial failure.
  const deliveries = await subdirectories(options.root)
  const series: RadarRainfallSeries[] = []
  let skipped = 0

  for (const delivery of deliveries) {
    options.collector.progress(`  delivery ${delivery}…`)

    // Products are read from the delivery, never from a list frozen in code:
    // the live route serves eight of them and the deliveries carry nine.
    let products: string[]
    try {
      products = await subdirectories(join(options.root, delivery))
    } catch (error) {
      options.collector.failed(`delivery ${delivery}`, error)
      continue
    }
    if (products.length === 0) options.collector.withoutData(delivery)

    for (const product of products) {
      const scan = await scanProduct(options, delivery, product)
      if (scan === undefined) continue
      skipped += scan.skipped

      const frames = cropToWindow(scan.frames, options.window, (frame) => frame.at)
      if (frames.length === 0) {
        options.collector.withoutData(`${delivery}/${product}`)
        continue
      }

      series.push({
        delivery,
        product,
        medianStepMinutes: medianStepMinutes(frames.map((frame) => frame.at)),
        frames,
      })
    }
  }

  return { series, skipped }
}

/* eslint-disable-next-line max-statements -- reads a directory and keeps the frames named by a
   timestamp; the two failures it survives */
async function scanProduct(
  options: IndexOptions,
  delivery: string,
  product: string,
): Promise<{ frames: RadarRainfallFrame[]; skipped: number } | undefined> {
  const directory = join(options.root, delivery, product)

  // One unreadable product is a partial failure, like one station out of 94:
  // what is already indexed is kept and the series are still returned.
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    options.collector.failed(`${delivery}/${product}`, error)
    return undefined
  }

  const frames: RadarRainfallFrame[] = []
  let skipped = 0

  for (const entry of entries) {
    const match = entry.isFile() ? FRAME_FILENAME.exec(entry.name) : null
    if (match === null) {
      skipped += 1
      continue
    }
    try {
      frames.push({
        at: fromEpochSeconds(Number(match[1])),
        path: join(delivery, product, entry.name),
      })
    } catch (error) {
      options.collector.failed(`${delivery}/${product}/${entry.name}`, error)
    }
  }

  frames.sort((a, b) => (a.at < b.at ? -1 : 1))
  return { frames, skipped }
}

async function subdirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
