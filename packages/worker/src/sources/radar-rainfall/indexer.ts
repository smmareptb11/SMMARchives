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
 * Indexes the delivered radar rainfall images on disk. The producer exposes no
 * history, only an undated `last.png`: the history arrives as deliveries.
 *
 * Filenames are production times, not slots: steps are irregular and products
 * do not share timestamps. This indexes what exists, and the consumer looks for
 * the nearest neighbour.
 */
/* eslint-disable-next-line max-statements -- one pass per delivery and per product, an unreadable
   one costing itself alone */
export async function indexDeliveries(options: IndexOptions): Promise<IndexResult> {
  // An unreadable root is the one configuration failure: a root holding no
  // delivery is not, and anything unreadable deeper down is a partial failure.
  const deliveries = await subdirectories(options.root)
  const series: RadarRainfallSeries[] = []
  let skipped = 0

  for (const delivery of deliveries) {
    options.collector.progress(`  delivery ${delivery}…`)

    // Products are read from the delivery: the live route serves fewer than a delivery carries.
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
