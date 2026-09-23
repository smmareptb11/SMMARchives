import { z } from 'zod'

import {
  frozenWebcamImageSchema,
  referenceLayerSchema,
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
import { REFERENCE_LAYERS, fetchReferenceLayers } from '../../sources/lizmap/layers.ts'
import type { ReplayBuild } from '../build-state.ts'
import { downloadMedia } from '../media.ts'
import { withPreserved } from '../preserve.ts'
import type { ReplayStore } from '../store.ts'

export type LizmapSource = {
  client: LizmapClient
  /** Fetches the images themselves, which live on another host than the Lizmap. */
  fetch: Fetch
}

export type LizmapLaneOptions = {
  build: ReplayBuild
  source: LizmapSource
  identity: ReplayIdentity
  /** Where the images are frozen. The build's own store never leaves it. */
  store: ReplayStore
  /** False skips the download, for a quick run; the data set then holds no path. */
  copyMedia: boolean
}

const IMAGES = z.array(frozenWebcamImageSchema)

/**
 * Collects the reference layers, the exploitable cameras and their images.
 *
 * One lane for the three because they go through one host — and one client, so
 * one anonymous session: the OGC proxy answers `Forbidden` until a `PHPSESSID`
 * is obtained, and the Lizmap is a crisis tool in production whose calls stay
 * spaced. Splitting them would open a session per data set.
 *
 * The images are the exception to that host: they sit with their own host, and
 * freezing them is what keeps a replay from emptying itself a month later.
 */
export async function collectLizmap(options: LizmapLaneOptions): Promise<void> {
  const { build, source, identity } = options

  await build.runLane('lizmap', async () => {
    const layers = build.collectorFor('lizmap', 'fetch:lizmap:layers', {
      layers: [...REFERENCE_LAYERS],
    })
    const collected = await fetchReferenceLayers({
      client: source.client,
      collector: layers,
      layers: REFERENCE_LAYERS,
    })
    // No extent here: these layers *are* the extent referential — the user
    // traces theirs from them — and intersecting polygons is PostGIS's job.
    await build.stored(
      'reference-layers',
      z.array(referenceLayerSchema),
      { data: collected, report: layers.seal() },
      collected.length,
    )

    const positions = build.collectorFor('lizmap', 'fetch:webcams:positions', {
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
 * Lists the images of the retained cameras, freezes them, and stores the index.
 *
 * Stored after the download, never before: the data set has to point at the
 * copies, and an image whose fetch failed must say so rather than name a file
 * that is not there.
 */
/* eslint-disable-next-line max-lines-per-function -- lists, downloads and stores in one pass,
   because the index must point at the copies */
async function freezeImages(options: LizmapLaneOptions, webcams: readonly Webcam[]): Promise<void> {
  const { build, source, identity } = options
  const codes = webcams.map((one) => one.code)

  const listing = build.collectorFor('lizmap', 'fetch:webcams:images', {
    from: identity.period.from,
    to: identity.period.to,
    codes,
  })
  // The codes come from the positions just collected, so the camera layer is
  // read once for the lane rather than once per data set.
  const { images, beyondRetention } = await fetchWebcamImages({
    client: source.client,
    collector: listing,
    codes,
    window: identity.period,
  })

  // Its own collector, and its own report name: the failures of a download must
  // not be attributed to a script that downloads nothing.
  const media = options.copyMedia
    ? build.collectorFor('lizmap', 'replay:media', { prefix: 'webcams' })
    : undefined
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

  const kept = await withPreserved({
    store: options.store,
    collector: listing,
    dataset: 'webcam-images',
    contract: IMAGES,
    collected: listed,
    keyOf: (image) => `${image.code} ${image.at}`,
    isStillHeld: async (image) =>
      image.storedPath !== null && (await options.store.hasMedia(image.storedPath)),
    groupOf: (image) => `webcam ${image.code}`,
    rule: 'the data set holds what the listing offers',
  })
  kept.sort((a, b) => (a.at === b.at ? a.code.localeCompare(b.code) : a.at < b.at ? -1 : 1))

  await build.stored(
    'webcam-images',
    IMAGES,
    { data: kept, report: listing.seal({ beyondRetention }) },
    kept.length,
  )
  if (media !== undefined && frozen !== undefined) {
    await build.copied(frozen.tally)
    await build.noteFailures('lizmap', media)
  }
}

/**
 * Says how many views a lane will have to draw from the full image.
 *
 * On the listing's collector, because that is the one the `webcam-images`
 * report is sealed from — the download has its own, which only carries what
 * went wrong with a file. One line for the batch rather than one per view: a
 * whole episode lists hundreds of pictures, and a report nobody can read
 * reports nothing.
 *
 * A fallback and not a failure: the replay holds every observation it was asked
 * for, and pays for the missing reductions in weight alone.
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
