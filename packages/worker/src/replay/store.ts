import { isAbsolute } from 'node:path'
import type { Readable } from 'node:stream'

import type {
  DatasetName,
  JournalEntry,
  Report,
  ReplayEvent,
  ReplayManifest,
} from '@smmarchives/shared'

import type { DatasetFilter } from './postgres/datasets/index.ts'

export type { DatasetFilter }

/**
 * A medium small enough to hold, or a stream to pipe straight through: a
 * delivery holds thousands, and none may stay in memory past its own write.
 */
export type MediaBody = Uint8Array | ReadableStream<Uint8Array>

/**
 * What an agent writes of an event. The rest is the store's to settle: the
 * identifier, the origin and the category.
 */
export type ManualEvent = Pick<
  ReplayEvent,
  'title' | 'description' | 'producerKind' | 'link' | 'from' | 'to' | 'position' | 'media'
>

/**
 * Stored bytes, ready to be served without being decoded.
 *
 * **The body is an open resource, and its reader owns it**: read it to the end
 * or destroy it, or a file handle stays open for good.
 *
 * `size` and `version` describe the bytes the body yields, not a later state of
 * that name. `version` is opaque, the material of an ETag.
 */
export type StoredBlob = {
  body: Readable
  size: number
  version: string
}

/**
 * Where a replay is stored. Three rules hold for every implementation:
 *
 * - no absolute path crosses it: a medium is addressed relative to its replay;
 * - **what it receives** has already been checked against its contract, so an
 *   implementation stores rather than validates;
 * - **a read that promises a type checks it**, and a read that answers bytes
 *   answers them as they are: storage is where a value arrives from outside the
 *   process.
 */
export type ReplayStore = {
  /**
   * The data set as bytes, narrowed by the filter. A filter a data set does not
   * answer to is refused by its caller, never ignored here.
   */
  openDataset(name: DatasetName, filter?: DatasetFilter): Promise<StoredBlob | undefined>
  /** The report is the one a reader finds beside the data, from the moment it is stored. */
  putDataset(name: DatasetName, data: unknown, report: Report): Promise<void>
  /**
   * The manifest as it is stored, or undefined if nothing stored one. Throws
   * {@link CorruptManifestError} for one nobody can read.
   */
  getManifest(): Promise<ReplayManifest | undefined>
  /** Leaves the publication as it was: a build neither publishes nor withdraws. */
  putManifest(manifest: ReplayManifest): Promise<void>
  /**
   * Opens the replay to everyone, and answers false when it is not complete —
   * checked in the same statement, so no build can change the state between.
   * A replay already published keeps the date it was first published.
   */
  publish(): Promise<boolean>
  unpublish(): Promise<void>
  /** Fails a replay its build left running; a replay that settled keeps its state. */
  abandon(): Promise<void>
  /**
   * Takes the replay for the build that asks, and answers false when another
   * build already took it — checked in the same statement, so two builds
   * started together cannot both go in.
   */
  claim(): Promise<boolean>
  appendJournal(entry: JournalEntry): Promise<void>
  /**
   * The entries from the given line on. A build appends while a reader reads: a
   * last line still half written is left out, and arrives on the next read.
   */
  readJournal(from: number): Promise<JournalEntry[]>
  /**
   * The medium as bytes, or undefined if the replay never froze it. Refuses a
   * path that would leave the replay, as every method addressing a medium does.
   */
  openMedia(path: string): Promise<StoredBlob | undefined>
  putMedia(path: string, body: MediaBody): Promise<void>
  /**
   * Takes a medium off the volume. One already gone is no error: what was
   * asked for is that it no longer be there.
   */
  removeMedia(path: string): Promise<void>
  /**
   * Adds an event an agent reported to the `events` data set, and answers it as
   * a reader will read it. The data set's version moves.
   */
  addManualEvent(event: ManualEvent): Promise<ReplayEvent>
  /** Undefined for an identifier nobody holds, and for a crossing, as for the two below. */
  getManualEvent(id: string): Promise<ReplayEvent | undefined>
  /**
   * Replaces what an agent wrote of an event, photos included, and answers it as
   * it was and as it now is: the photos it no longer names are the caller's to
   * remove, once the rows no longer point at them.
   *
   * Undefined for an identifier nobody holds, and for a crossing, which is
   * derived from the frozen measures.
   */
  updateManualEvent(id: string, event: ManualEvent): Promise<ManualEventChange | undefined>
  /** Removes it for good, and answers what it was, so that its photos can follow. */
  removeManualEvent(id: string): Promise<ReplayEvent | undefined>
}

export type ManualEventChange = { previous: ReplayEvent; current: ReplayEvent }

/**
 * A manifest is there and its own contract refuses it: a listing carries on
 * without that replay, a request by name fails. The message names the replay
 * and nothing else, since an API serves it.
 */
export class CorruptManifestError extends Error {
  readonly id: string

  constructor(id: string, options?: { cause?: unknown }) {
    super(`replay ${id} holds a manifest its contract refuses`, options)
    this.name = 'CorruptManifestError'
    this.id = id
  }
}

/**
 * Whether a medium's address stays inside its replay, judged on the shape of the
 * path alone so that every implementation gets the same answer.
 */
export function isMediaPath(path: string): boolean {
  return (
    path !== '' &&
    !isAbsolute(path) &&
    !path.split('/').includes('..') &&
    // A reader that passed a null byte on would read what precedes it as the path.
    !path.includes('\0')
  )
}

/** Refuses on the caller's behalf what {@link isMediaPath} judges. */
export function relativeMediaPath(path: string): string {
  if (!isMediaPath(path)) throw new Error(`Media path lands outside the replay: ${path}`)
  return path
}
