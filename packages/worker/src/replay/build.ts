import type { RadarRainfallSeries, ReplayIdentity } from '@smmarchives/shared'

import { ReplayBuild, type BuildResult } from './build-state.ts'
import { collectAquasys, type AquasysSource } from './lanes/aquasys.ts'
import { deriveEvents } from './lanes/events.ts'
import { collectLizmap, type LizmapSource } from './lanes/lizmap.ts'
import { collectRadarRainfall, type RadarRainfallSource } from './lanes/radar-rainfall.ts'
import { copyLocalMedia } from './media.ts'
import type { ReplayStore } from './store.ts'

export type { BuildResult } from './build-state.ts'
export type { AquasysSource } from './lanes/aquasys.ts'
export type { LizmapSource } from './lanes/lizmap.ts'
export type { RadarRainfallSource } from './lanes/radar-rainfall.ts'

export type BuildOptions = {
  identity: ReplayIdentity
  store: ReplayStore
  /**
   * The sources to collect from. A lane runs when its source is given, so
   * selecting a lane without what it needs is unrepresentable — and a replay of
   * the delivered rasters alone needs no Aquasys access at all.
   */
  aquasys?: AquasysSource | undefined
  lizmap?: LizmapSource | undefined
  radarRainfall?: RadarRainfallSource | undefined
  copyMedia: boolean
  /** Where progress goes beside the journal. Silent by default. */
  onProgress?: ((message: string) => void) | undefined
}

/**
 * Builds a replay: collects, freezes and stores everything its extent and its
 * period cover.
 *
 * A lane that fails never stops the others — an unreachable source costs its own
 * data sets, not the replay — which is why nothing here throws on a collection
 * error and why the manifest, not the return value, carries what went wrong.
 */
/* eslint-disable-next-line complexity -- three sources that may be absent, and the tests of
   what each lane settled on; a list, not a nesting */
export async function buildReplay(options: BuildOptions): Promise<BuildResult> {
  const build = new ReplayBuild(options.identity, options.store, options.onProgress)
  await build.publish()

  // Lanes advance together because they read different places: one host, one
  // volume. Each stays sequential inside, since a client spaces its own calls
  // and that spacing is not concurrency-safe. `allSettled` rather than `all`:
  // the lanes catch their own failures, and a lane that threw anyway must not
  // take the other down with it.
  const radar = options.radarRainfall
  const [indexed, collected] = await Promise.allSettled([
    radar === undefined ? undefined : collectRadarRainfall(build, radar, options.identity.period),
    options.aquasys === undefined
      ? undefined
      : collectAquasys(build, options.aquasys, options.identity),
    options.lizmap === undefined
      ? undefined
      : collectLizmap({
          build,
          source: options.lizmap,
          identity: options.identity,
          store: options.store,
          copyMedia: options.copyMedia,
        }),
  ])

  // Both lanes below read no source: they work on what a collection returned,
  // and they are lanes of their own so that a failure in one stays theirs.
  const derivable = collected.status === 'fulfilled' ? collected.value : undefined
  if (derivable !== undefined) await deriveEvents(build, derivable)

  const series = indexed.status === 'fulfilled' ? indexed.value : undefined
  if (options.copyMedia && radar !== undefined && series !== undefined) {
    await freezeRadarFrames(build, options.store, radar.root, series)
  }

  return build.settle()
}

/**
 * Copies into the replay the frames the index kept.
 *
 * Only those: a delivery runs to 540 MB uncropped, and a replay covers a few
 * days of it. Geographic cropping stays out until the raster extent is
 * confirmed — cropping on a wrong extent is destructive, keeping the whole
 * mosaic only costs disk.
 */
async function freezeRadarFrames(
  build: ReplayBuild,
  store: ReplayStore,
  root: string,
  series: readonly RadarRainfallSeries[],
): Promise<void> {
  await build.runLane('media', async () => {
    const collector = build.collectorFor('media')
    const tally = await copyLocalMedia({
      store,
      collector,
      root,
      paths: series.flatMap((one) => one.frames.map((frame) => frame.path)),
      prefix: 'radar',
    })
    await build.copied(tally)
    await build.noteFailures('media', collector)
  })
}
