import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import {
  FROZEN_MEDIA_EXTENSIONS,
  toEpochMilliseconds,
  type Instant,
  type FrozenWebcamImage,
  type MediaTally,
  type ReportCollector,
  type WebcamImage,
} from '@smmarchives/shared'

import { HttpClient, type Fetch } from '../http.ts'
import type { ReplayStore } from './store.ts'

export type CopyLocalMediaOptions = {
  store: ReplayStore
  collector: ReportCollector
  /** The directory the paths are relative to. */
  root: string
  /** Paths relative to `root`, mirrored under the replay below `prefix`. */
  paths: readonly string[]
  prefix: string
}

/**
 * Copies delivered files into the replay.
 *
 * The freeze is the point: a replay that only pointed at the deliveries
 * directory would empty itself the day the volume is reorganised. Paths are
 * mirrored, so a frame indexed as `20044/pluvio5mn/1593102683.png` is found
 * again under the same path below `prefix`.
 *
 * A file already present is not copied again, which is what makes re-running a
 * build cheap. One failure is recorded and does not stop the others: a missing
 * raster costs one frame, not the replay.
 */
export async function copyLocalMedia(options: CopyLocalMediaOptions): Promise<MediaTally> {
  const tally = emptyTally()
  const tick = options.collector.progressEvery(options.paths.length, 'media', 100)

  for (const path of options.paths) {
    await freezeOne({
      store: options.store,
      tally,
      target: `${options.prefix}/${path}`,
      read: () => readFile(join(options.root, path)),
      onFailure: (error) => {
        options.collector.failed(`media ${path}`, error)
        tally.failed += 1
      },
    })
    tick()
  }

  return tally
}

function emptyTally(): MediaTally {
  return { copied: 0, skipped: 0, failed: 0, bytes: 0 }
}

type FreezeOneOptions = {
  store: ReplayStore
  tally: MediaTally
  target: string
  read: () => Promise<Uint8Array>
  /**
   * What an failure costs, which is the only thing the two freezes disagree on.
   *
   * An observation that cannot be had truncates the replay and is counted; a
   * reduction that cannot be had costs the strip its weight and nothing else.
   */
  onFailure: (error: unknown) => void
}

/**
 * Freezes one medium, whatever it is read from.
 *
 * The four steps every freeze shares — skip what the store already has, read,
 * store, count — written once. What differs between a delivered raster and a
 * remote image is where the bytes come from and how the walk is paced, so those
 * stay with their callers.
 *
 * Returns whether the replay now holds it, which is the only thing a caller
 * needs to decide what to record.
 */
async function freezeOne(options: FreezeOneOptions): Promise<boolean> {
  try {
    if (await options.store.hasMedia(options.target)) {
      options.tally.skipped += 1
      return true
    }
    const body = await options.read()
    await options.store.putMedia(options.target, body)
    options.tally.copied += 1
    options.tally.bytes += body.byteLength
    return true
  } catch (error) {
    options.onFailure(error)
    return false
  }
}

export type DownloadMediaOptions = {
  store: ReplayStore
  collector: ReportCollector
  images: readonly WebcamImage[]
  prefix: string
  fetch: Fetch
  /**
   * How many downloads run at once.
   *
   * The images sit on another host than the Lizmap whose calls we space, so a
   * little concurrency is legitimate here — and small, because it is still
   * somebody else's server.
   */
  concurrency?: number
}

export type DownloadResult = {
  /** The same images, each pointing at its frozen copy, or at nothing. */
  images: FrozenWebcamImage[]
  tally: MediaTally
  /**
   * Why reductions were not frozen, once per distinct reason.
   *
   * Distinct rather than one entry per view: a listing holds hundreds, and a
   * disk that filled up says the same thing about every one of them. Reported
   * so a run that lost its reductions to a full volume does not read as Ceneau
   * having published none.
   */
  thumbnailProblems: string[]
}

/**
 * Freezes the webcam images into the replay.
 *
 * The whole reason the freeze exists on this source: Ceneau keeps an image for
 * a month, so a replay holding only URLs empties itself without warning once
 * that month has passed.
 *
 * The path is derived from the code and the instant, never from the remote file
 * name, so a re-run recognises what it already has. An image that cannot be
 * fetched costs its own frame and leaves `storedPath` null — the replay says
 * which images it does not hold rather than pointing at a file that is not
 * there.
 */
export async function downloadMedia(options: DownloadMediaOptions): Promise<DownloadResult> {
  const tally = emptyTally()
  const http = new HttpClient({ fetch: options.fetch })
  const tick = options.collector.progressEvery(options.images.length, 'images', 25)
  const concurrency = options.concurrency ?? 2
  const images: FrozenWebcamImage[] = []
  const run: Run = { options, http, tally, problems: new Set() }

  // By batches rather than a shared cursor: the order out is then the order in
  // by construction, which is the order a run with no download produces. At two
  // at a time over a few hundred images, waiting for a batch costs nothing.
  for (let at = 0; at < options.images.length; at += concurrency) {
    const batch = await Promise.all(
      options.images.slice(at, at + concurrency).map(async (image) => {
        const frozen = await freeze(image, run)
        tick()
        return frozen
      }),
    )
    images.push(...batch)
  }

  return { images, tally, thumbnailProblems: [...run.problems] }
}

/** What every freeze of one run shares, gathered rather than threaded through. */
type Run = {
  options: DownloadMediaOptions
  http: HttpClient
  tally: MediaTally
  problems: Set<string>
}

async function freeze(image: WebcamImage, run: Run): Promise<FrozenWebcamImage> {
  const { options, tally } = run
  const storedPath = `${options.prefix}/${image.code}/${epochOf(image.at)}${extensionOf(image.uri)}`
  const held = await freezeOne({
    store: options.store,
    tally,
    target: storedPath,
    read: async () => new Uint8Array(await (await run.http.response(image.uri)).arrayBuffer()),
    onFailure: (error) => {
      options.collector.failed(`image ${image.code} ${image.at}`, error)
      tally.failed += 1
    },
  })

  return {
    ...image,
    storedPath: held ? storedPath : null,
    storedThumbPath: await freezeThumbnail(image, run),
  }
}

/**
 * Freezes the reduction Ceneau publishes beside the picture, when it does.
 *
 * A lane drawn from the full images fetches some six hundred kilobytes a view
 * to paint eighty pixels of strip; the reduction is four. So it is an economy
 * and never the observation: one that cannot be had leaves the replay whole,
 * counts no failure, and truncates nothing. The reason is kept all the same —
 * the freeze can fail on the volume as well as on Ceneau, and reporting a full
 * disk as a camera publishing nothing would send someone looking at Ceneau.
 */
async function freezeThumbnail(image: WebcamImage, run: Run): Promise<string | null> {
  const uri = image.thumbUri
  if (uri === null) return null

  const { options, tally } = run
  const target = `${options.prefix}/${image.code}/thumbs/${epochOf(image.at)}${extensionOf(uri)}`
  const held = await freezeOne({
    store: options.store,
    tally,
    target,
    read: async () => new Uint8Array(await (await run.http.response(uri)).arrayBuffer()),
    onFailure: (error) => remember(run.problems, error),
  })

  return held ? target : null
}

/**
 * Keeps why reductions were lost, in a few words and a few entries.
 *
 * Capped, because the reasons are not as distinct as they look: a volume that
 * filled up names its own temporary file in every message, so a thousand images
 * would write a thousand strings into a report that is stored with the replay
 * and re-served on every open. Five is enough to tell someone where to look.
 */
const REASONS_KEPT = 5

function remember(problems: Set<string>, error: unknown): void {
  if (problems.size >= REASONS_KEPT) return
  problems.add(error instanceof Error ? error.message : String(error))
}

/**
 * Milliseconds, not seconds: two frames of one camera inside the same second
 * would otherwise resolve to one path, and the second would be counted skipped
 * while pointing at the first one's file.
 */
function epochOf(at: Instant): number {
  return toEpochMilliseconds(at)
}

/**
 * The remote name is not stable enough to keep; only its kind is worth carrying.
 *
 * Ceneau serves JPEG, so an unrecognised extension is stored as one rather than
 * sniffed from the bytes: the path is an address, and nothing reads it back to
 * decide how to decode the file.
 */
function extensionOf(uri: string): string {
  // Total, because it already has an answer for what it does not recognise, and
  // every caller reaches it while building a path — where an exception is the
  // one thing nobody is placed to catch.
  const extension = extname(URL.parse(uri)?.pathname ?? '')
    .slice(1)
    .toLowerCase()
  return FROZEN_MEDIA_EXTENSIONS.has(extension) ? `.${extension}` : '.jpg'
}
