import type { LaneName, RadarRainfallSeries, ReplayIdentity } from '@smmarchives/shared'

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
  /** The sources to collect from: a lane runs when its source is given. */
  aquasys?: AquasysSource | undefined
  lizmap?: LizmapSource | undefined
  radarRainfall?: RadarRainfallSource | undefined
  copyMedia: boolean
  /**
   * The instant the build judges what its sources still hold against, since
   * Ceneau forgets an image after a month. The real time by default.
   */
  now?: Date | undefined
  /** Where progress goes beside the journal. Silent by default. */
  onProgress?: ((message: string) => void) | undefined
}

/**
 * Builds a replay: collects, freezes and stores everything its extent and its
 * period cover. A lane that fails never stops the others, and the manifest, not
 * an exception, carries what went wrong.
 */
/* eslint-disable-next-line complexity -- three sources that may be absent, and the tests of
   what each lane settled on; a list, not a nesting */
export async function buildReplay(options: BuildOptions): Promise<BuildResult> {
  const build = new ReplayBuild(options.identity, options.store, options.onProgress)
  build.plan(plannedLanes(options))
  await build.publish()

  // Each lane reads its own source, so they advance together. `allSettled`, so
  // that a lane that threw anyway does not take the others down with it.
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
          now: options.now,
        }),
  ])

  // Lanes of their own, though they read no source, so that a failure in one stays theirs.
  const derivable = collected.status === 'fulfilled' ? collected.value : undefined
  if (derivable !== undefined) await deriveEvents(build, derivable)

  const series = indexed.status === 'fulfilled' ? indexed.value : undefined
  if (options.copyMedia && radar !== undefined && series !== undefined) {
    await freezeRadarFrames(build, options.store, radar.root, series)
  }

  return build.settle()
}

/** The lanes a build will run: those whose source it was given, and what derives from them. */
function plannedLanes(options: BuildOptions): LaneName[] {
  const lanes: LaneName[] = []
  if (options.aquasys !== undefined) lanes.push('aquasys', 'events')
  if (options.lizmap !== undefined) lanes.push('lizmap')
  if (options.radarRainfall !== undefined) {
    lanes.push('radar-rainfall')
    if (options.copyMedia) lanes.push('media')
  }
  return lanes
}

/**
 * Copies into the replay the frames the index kept, uncropped: no file states
 * the raster extent, and cropping on a wrong one destroys what it cuts.
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
