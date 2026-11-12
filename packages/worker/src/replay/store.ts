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
 * A medium small enough to hold, or a stream to pipe straight through.
 *
 * A raster weighs about a hundred kilobytes and a webcam image less, but a
 * delivery holds thousands of them: nothing accumulates in memory beyond the
 * one being written.
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
 * or destroy it. Neither, and the implementation holds a file handle nobody
 * will ever close.
 *
 * `size` and `version` describe the bytes the body will yield, and no later
 * state of that name — an agent may change the events while they are being
 * served. `version` is the material of an ETag and nothing else: opaque to its
 * reader, which only ever compares it with itself.
 */
export type StoredBlob = {
  body: Readable
  size: number
  version: string
}

/**
 * Where a replay is stored.
 *
 * The seam by which PostgreSQL and PostGIS will replace the file system without
 * a single collector changing. Three rules keep it a seam:
 *
 * - no absolute path ever crosses it — a medium is addressed relative to its
 *   replay;
 * - **what it receives** has already been checked against its contract, so an
 *   implementation stores rather than validates;
 * - **a read that promises a type earns it**, and a read that answers bytes
 *   answers them as they are. Storage is the one place a value can arrive from
 *   outside the process, so a typed reader that trusted it would hand a lie to
 *   everything downstream.
 */
export type ReplayStore = {
  /**
   * The data set as bytes, narrowed by what the caller asked for.
   *
   * Serialised from the rows that hold it, so a reader that only wants one
   * station over one hour is not handed the 19 MB the whole set weighs. A
   * filter a data set does not answer to is refused by its caller, never
   * ignored here.
   */
  openDataset(name: DatasetName, filter?: DatasetFilter): Promise<StoredBlob | undefined>
  /** The report is the one a reader finds beside the data, from the moment it is stored. */
  putDataset(name: DatasetName, data: unknown, report: Report): Promise<void>
  /**
   * The manifest as it is stored, or undefined if nothing stored one.
   *
   * A build holds its own in memory and never reads it back; a reader has no
   * other way to know what a replay holds.
   *
   * Throws {@link CorruptManifestError} rather than answering undefined, so a
   * caller can tell a replay nobody built from one nobody can read.
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
  /**
   * Says a build will not settle the replay it left running: it is failed.
   *
   * A replay that settled keeps its state, so a build that stops after its last
   * publication takes nothing back.
   */
  abandon(): Promise<void>
  /**
   * Takes the replay for the build that asks, and answers false when another
   * build already took it — checked in the same statement, so two builds
   * started together cannot both go in.
   */
  claim(): Promise<boolean>
  appendJournal(entry: JournalEntry): Promise<void>
  /**
   * The entries from the given line on, so a reader resumes on an index rather
   * than replaying what it has already shown.
   *
   * A build appends while a reader reads, so the last line may be half
   * written: it is left out until it is whole, and arrives on the next read.
   * Answers no entry at all for a build that journalled nothing.
   */
  readJournal(from: number): Promise<JournalEntry[]>
  /**
   * The medium as bytes, or undefined if the replay never froze it.
   *
   * Refuses a path that would leave the replay, as every method addressing a
   * medium does — see {@link relativeMediaPath}.
   */
  openMedia(path: string): Promise<StoredBlob | undefined>
  putMedia(path: string, body: MediaBody): Promise<void>
  /**
   * Takes a medium off the volume. One already gone is no error: what was
   * asked for is that it no longer be there.
   */
  removeMedia(path: string): Promise<void>
  /**
   * Adds an event an agent reported to the `events` data set, and answers it
   * as a reader will read it.
   *
   * The data set's version moves, so a reader holding the list from before is
   * told to fetch it again.
   */
  addManualEvent(event: ManualEvent): Promise<ReplayEvent>
  /** Undefined for an identifier nobody holds, and for a crossing, as for the two below. */
  getManualEvent(id: string): Promise<ReplayEvent | undefined>
  /**
   * Replaces what an agent wrote of an event, photos included, and answers it
   * as it was and as it now is: the photos it no longer names are the caller's
   * to remove, once the rows no longer point at them.
   *
   * Undefined for an identifier nobody holds, and for a crossing: one is
   * derived from the frozen measures, and corrected by hand it would no longer
   * say what they said.
   */
  updateManualEvent(id: string, event: ManualEvent): Promise<ManualEventChange | undefined>
  /** Removes it for good, and answers what it was, so that its photos can follow. */
  removeManualEvent(id: string): Promise<ReplayEvent | undefined>
}

export type ManualEventChange = { previous: ReplayEvent; current: ReplayEvent }

/**
 * A manifest is there and its own contract refuses it.
 *
 * Its own type because the two readers of a manifest want opposite things: a
 * listing carries on without that replay, while asking for it by name must
 * fail. The message names the replay and nothing else — an API serves it, and
 * the reason belongs in the server's own log.
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
 * Checks a medium's address against the rule that makes the port a seam.
 *
 * Here rather than in the directory implementation, because it is the port's own
 * invariant: an adapter that let an absolute path or a `..` through would write
 * into another replay, and a database adapter has no file system to make the
 * violation obvious. Judged on the shape of the path, so every implementation
 * gets the same answer without resolving anything.
 */
export function isMediaPath(path: string): boolean {
  return (
    path !== '' &&
    !isAbsolute(path) &&
    !path.split('/').includes('..') &&
    // No file name holds a null byte, and a reader that passed one on would
    // have whatever precedes it read as the whole path.
    !path.includes('\0')
  )
}

/** Refuses on the caller's behalf what {@link isMediaPath} judges. */
export function relativeMediaPath(path: string): string {
  if (!isMediaPath(path)) throw new Error(`Media path lands outside the replay: ${path}`)
  return path
}
