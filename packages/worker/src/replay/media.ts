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
 * Copies delivered files into the replay, so that it outlives a reorganised
 * volume. One failure is recorded and costs one frame, not the replay.
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
      observation: true,
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
  return { copied: 0, failed: 0, bytes: 0 }
}

type FreezeOneOptions = {
  store: ReplayStore
  tally: MediaTally
  target: string
  read: () => Promise<Uint8Array>
  /**
   * Whether the tally counts it copied. A reduction counts in the bytes alone:
   * one lost truncates nothing, so one kept must not inflate what the replay holds.
   */
  observation: boolean
  onFailure: (error: unknown) => void
}

/** Freezes one medium, whatever it is read from, and answers whether the replay now holds it. */
async function freezeOne(options: FreezeOneOptions): Promise<boolean> {
  try {
    const body = await options.read()
    await options.store.putMedia(options.target, body)
    if (options.observation) options.tally.copied += 1
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
   * How many downloads run at once: the images are not on the Lizmap host whose
   * calls we space, but still on somebody else's server, so keep it small.
   */
  concurrency?: number
}

export type DownloadResult = {
  /** The same images, each pointing at its frozen copy, or at nothing. */
  images: FrozenWebcamImage[]
  tally: MediaTally
  /**
   * Why reductions were not frozen, once per distinct reason: a run that lost
   * them to a full volume must not read as Ceneau having published none.
   */
  thumbnailProblems: string[]
}

/**
 * Freezes the webcam images into the replay: Ceneau keeps an image for a month.
 *
 * The path comes from the code and the instant, never from the remote file
 * name, which is not stable. An image that cannot be fetched leaves
 * `storedPath` null rather than pointing at a file that is not there.
 */
export async function downloadMedia(options: DownloadMediaOptions): Promise<DownloadResult> {
  const tally = emptyTally()
  const http = new HttpClient({ fetch: options.fetch })
  const tick = options.collector.progressEvery(options.images.length, 'images', 25)
  const concurrency = options.concurrency ?? 2
  const images: FrozenWebcamImage[] = []
  const run: Run = { options, http, tally, problems: new Set() }

  // By batches rather than a shared cursor, so the order out is the order in.
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
    observation: true,
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
 * Freezes the reduction Ceneau publishes beside the picture, when it does. An
 * economy for the lane, never the observation: one that cannot be had counts no
 * failure, but its reason is kept, since the volume can fail as well as Ceneau.
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
    observation: false,
    onFailure: (error) => remember(run.problems, error),
  })

  return held ? target : null
}

/**
 * Capped, because the reasons are not as distinct as they look: a full volume
 * names its own temporary file in every message, and the report is stored with
 * the replay.
 */
const REASONS_KEPT = 5

function remember(problems: Set<string>, error: unknown): void {
  if (problems.size >= REASONS_KEPT) return
  problems.add(error instanceof Error ? error.message : String(error))
}

/** Milliseconds, not seconds: two frames of one camera inside one second would share a path. */
function epochOf(at: Instant): number {
  return toEpochMilliseconds(at)
}

/**
 * The remote file's kind. Ceneau serves JPEG, so an unrecognised extension is
 * stored as one rather than sniffed: nothing decodes the file by its path.
 */
function extensionOf(uri: string): string {
  // Never throws: every caller reaches it while building a path, with nothing to catch.
  const extension = extname(URL.parse(uri)?.pathname ?? '')
    .slice(1)
    .toLowerCase()
  return FROZEN_MEDIA_EXTENSIONS.has(extension) ? `.${extension}` : '.jpg'
}
