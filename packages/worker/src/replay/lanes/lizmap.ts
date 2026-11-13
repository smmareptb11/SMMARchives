import { z } from 'zod'

import {
  frozenWebcamImageSchema,
  webcamSchema,
  type FrozenWebcamImage,
  type ReportCollector,
  type ReplayIdentity,
  type Webcam,
  type WebcamImage,
} from '@smmarchives/shared'

import type { Fetch } from '../../http.ts'
import { fetchWebcamImages } from '../../sources/ceneau/images.ts'
import { fetchWebcamPositions } from '../../sources/ceneau/webcams.ts'
import { LizmapClient } from '../../sources/lizmap/client.ts'
import type { ReplayBuild } from '../build-state.ts'
import { downloadMedia } from '../media.ts'
import type { ReplayStore } from '../store.ts'

export type LizmapSource = {
  client: LizmapClient
  /** Fetches the images themselves, which live on another host than the Lizmap. */
  fetch: Fetch
}

type LizmapLaneOptions = {
  build: ReplayBuild
  source: LizmapSource
  identity: ReplayIdentity
  /** Where the images are frozen. The build's own store never leaves it. */
  store: ReplayStore
  /** False skips the download, for a quick run; the data set then holds no path. */
  copyMedia: boolean
  /** What Ceneau's retention is judged against: the real time unless given. */
  now?: Date | undefined
}

const IMAGES = z.array(frozenWebcamImageSchema)

/** Collects the exploitable cameras and their images, both listed through one Lizmap client. */
export async function collectLizmap(options: LizmapLaneOptions): Promise<void> {
  const { build, source, identity } = options

  await build.runLane('lizmap', async () => {
    const positions = build.collectorFor('lizmap', {
      extent: identity.extent,
    })
    const webcams = await fetchWebcamPositions({
      client: source.client,
      collector: positions,
      extent: identity.extent ?? undefined,
    })
    await build.stored(
      'webcams',
      z.array(webcamSchema),
      { data: webcams, report: positions.seal() },
      webcams.length,
    )

    await freezeImages(options, webcams)
  })
}

/**
 * Lists the images of the retained cameras, freezes them, and stores the index:
 * after the download, so that it points at the copies, or at nothing.
 */
async function freezeImages(options: LizmapLaneOptions, webcams: readonly Webcam[]): Promise<void> {
  const { build, source, identity } = options
  const codes = webcams.map((one) => one.code)

  const listing = build.collectorFor('lizmap', {
    from: identity.period.from,
    to: identity.period.to,
    codes,
  })
  const { images, beyondRetention } = await fetchWebcamImages({
    client: source.client,
    collector: listing,
    codes,
    window: identity.period,
    now: options.now,
  })

  // Its own collector, so that a download's failures are not the listing's.
  const media = options.copyMedia ? build.collectorFor('lizmap') : undefined
  const frozen =
    media === undefined
      ? undefined
      : await downloadMedia({
          store: options.store,
          collector: media,
          images,
          prefix: 'webcams',
          fetch: source.fetch,
        })
  const listed = frozen?.images ?? images.map(unfrozen)

  if (frozen !== undefined) {
    sayWhichViewsHaveNoReduction(listing, frozen.images, frozen.thumbnailProblems)
  }

  const byInstant = [...listed].sort((a, b) =>
    a.at === b.at ? a.code.localeCompare(b.code) : a.at < b.at ? -1 : 1,
  )

  await build.stored(
    'webcam-images',
    IMAGES,
    { data: byInstant, report: listing.seal({ beyondRetention }) },
    byInstant.length,
  )
  if (media !== undefined && frozen !== undefined) {
    await build.copied(frozen.tally)
    await build.noteFailures('lizmap', media)
  }
}

/**
 * Says, on the listing's collector which seals the `webcam-images` report, how
 * many views fall back on the full image: one line for the batch, and a
 * fallback rather than a failure, since every observation is held.
 */
function sayWhichViewsHaveNoReduction(
  collector: ReportCollector,
  images: readonly FrozenWebcamImage[],
  problems: readonly string[],
): void {
  const without = images.filter((one) => one.storedThumbPath === null).length
  if (without === 0) return

  const count = `${String(without)} of ${String(images.length)} view(s) fall back on the full image`
  collector.fellBackTo({
    subject: 'webcams thumbnails',
    rule: 'a lane is drawn from the reduction Ceneau publishes beside the picture',
    applied: problems.length === 0 ? count : `${count}: ${problems.join('; ')}`,
  })
}

/** A run asked for no media holds no copy, and says so rather than omitting it. */
function unfrozen(image: WebcamImage): FrozenWebcamImage {
  return { ...image, storedPath: null, storedThumbPath: null }
}
