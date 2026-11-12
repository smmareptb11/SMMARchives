import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, rmdir, writeFile, type FileHandle } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { relativeMediaPath, type MediaBody, type ReplayStore, type StoredBlob } from '../store.ts'

export type MediaDirectoryOptions = {
  /** The volume holding every replay's bytes, one directory each. */
  root: string
  replayId: string
}

/**
 * The bytes of a replay, on the volume.
 *
 * They stay out of the database on purpose: one delivery of radar rasters runs
 * to 540 MB uncropped, and a database is not a file system. What the database
 * holds is the index — what a medium is, when it was taken, where it came from
 * — and this holds the medium itself.
 *
 * Hence the rule an operator has to know: the database and this volume are
 * backed up together, or a restore gives replays whose images are missing.
 */
export function openMediaDirectory(
  options: MediaDirectoryOptions,
): Pick<ReplayStore, 'openMedia' | 'putMedia' | 'removeMedia'> {
  // Resolved, not joined: a relative MEDIA_PATH would leave every target
  // relative while the containment check resolves its argument, and every copy
  // would fail with a message about traversal.
  const directory = resolve(options.root, options.replayId)

  return {
    async openMedia(path: string): Promise<StoredBlob | undefined> {
      return openBlob(join(directory, relativeMediaPath(path)))
    },

    async putMedia(path: string, body: MediaBody): Promise<void> {
      await writeAtomically(join(directory, relativeMediaPath(path)), body)
    },

    async removeMedia(path: string): Promise<void> {
      const target = join(directory, relativeMediaPath(path))
      await rm(target, { force: true })
      await removeIfEmpty(dirname(target), directory)
    },
  }
}

/**
 * The folder a medium was taken out of, once nothing is left in it: each
 * sending of photos has one of its own, and emptied it would stay on the
 * volume for good. Never the replay's own folder, and never one still holding
 * something, which `rmdir` refuses.
 */
async function removeIfEmpty(folder: string, replay: string): Promise<void> {
  if (folder === replay) return
  await rmdir(folder).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'ENOENT') throw error
  })
}

/** Where a replay's bytes live, for the one caller that removes them all. */
export function mediaDirectoryOf(root: string, replayId: string): string {
  return resolve(root, replayId)
}

/** Measures the handle, never the path: a write renames between the two. */
async function openBlob(path: string): Promise<StoredBlob | undefined> {
  let handle: FileHandle
  try {
    handle = await open(path, 'r')
  } catch (error) {
    if (!isAbsence(error)) throw error
    return undefined
  }

  const info = await handle.stat({ bigint: true })
  if (!info.isFile()) {
    await handle.close()
    return undefined
  }
  return {
    body: handle.createReadStream(),
    size: Number(info.size),
    version: `${info.ino.toString(16)}-${info.size.toString(16)}-${info.mtimeNs.toString(16)}`,
  }
}

/**
 * Only a name nothing answers to is an absence — one that is not there, and
 * one that walks through a file, `a.jpg/b`.
 *
 * A file that cannot be read — a permission, a volume gone — must not pass for
 * something a lane never produced. A misconfiguration is not dressed up as an
 * empty replay.
 */
export function isAbsence(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Writes through a temporary neighbour, so an interrupted run leaves either the
 * previous file or the new one, never half of either. `rename` is atomic within
 * a directory, which is why the temporary sits next to its target.
 *
 * The temporary is named per write rather than per target: two writes to the
 * same target would otherwise share one temporary and rename a file the other
 * was still writing.
 */
async function writeAtomically(path: string, body: MediaBody): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, body)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
