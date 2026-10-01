import { z } from 'zod'

import {
  radarRainfallSeriesSchema,
  type RadarRainfallConfig,
  type RadarRainfallSeries,
  type TimeWindow,
} from '@smmarchives/shared'

import { indexDeliveries } from '../../sources/radar-rainfall/indexer.ts'
import type { ReplayBuild } from '../build-state.ts'

export type RadarRainfallSource = RadarRainfallConfig

/**
 * Indexes the delivered radar rainfall over the replay's period.
 *
 * No network: the deliveries are dropped on a volume, which is why this lane is
 * the one a replay can be built from offline. It takes no geographic extent —
 * the images are France-wide mosaics and cropping stays out until their extent
 * is confirmed.
 */
export async function collectRadarRainfall(
  build: ReplayBuild,
  source: RadarRainfallSource,
  period: TimeWindow,
): Promise<RadarRainfallSeries[] | undefined> {
  return build.runLane('radar-rainfall', async () => {
    const collector = build.collectorFor('radar-rainfall', {
      root: source.root,
      from: period.from,
      to: period.to,
    })

    const { series, skipped } = await indexDeliveries({
      root: source.root,
      extent: source.extent,
      collector,
      window: period,
    })

    await build.stored(
      'radar-rainfall',
      z.array(radarRainfallSeriesSchema),
      {
        data: series,
        // Both belong to the run rather than to any series, and the extent
        // travels with the data because it is not confirmed: a wrong one shifts
        // the whole layer invisibly.
        report: collector.seal({ extent: source.extent, entriesSkipped: skipped }),
      },
      series.length,
    )
    return series
  })
}
