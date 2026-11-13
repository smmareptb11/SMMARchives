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
 * The bytes of a replay, on the volume: the database holds only their index.
 * The database and this volume are backed up together, or a restore gives
 * replays whose images are missing.
 */
export function openMediaDirectory(
  options: MediaDirectoryOptions,
): Pick<ReplayStore, 'openMedia' | 'putMedia' | 'removeMedia'> {
  // Resolved, not joined: with a relative MEDIA_PATH, every copy would fail as a traversal.
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
 * The folder a medium was taken out of, once nothing is left in it: each sending
 * of photos has its own. Never the replay's own folder.
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
 * Only a name nothing answers to is an absence, including one that walks
 * through a file, `a.jpg/b`. A file that cannot be read is an error, not a
 * medium the lane never produced.
 */
export function isAbsence(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Writes through a temporary in the same directory, where `rename` is atomic, so
 * an interrupted run never leaves half a file. One temporary per write, not per
 * target, so two writes to one target never share it.
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
