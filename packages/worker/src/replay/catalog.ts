import {
  replayIdSchema,
  type ReplayAbout,
  type ReplayIdentity,
  type ReplayManifest,
} from '@smmarchives/shared'

import type { ReplayStore } from './store.ts'

/** The level above one replay: what exists, and how to reach it. */
export type ReplayCatalog = {
  /**
   * Mints a replay, and the identity that names it: no client names a replay, so
   * none collides. What the administrator said of it is stored here, never by a
   * build.
   */
  create(
    identity: Omit<ReplayIdentity, 'id'>,
    about?: ReplayAbout,
  ): Promise<{ id: string; store: ReplayStore }>
  list(): Promise<ReplayManifest[]>
  /** Undefined on a replay that does not exist. A read never creates one. */
  open(id: string): Promise<ReplayStore | undefined>
  /**
   * Removes a replay whole, frozen media included, or answers `false` for no
   * replay by that name or a name {@link isReplayId} refuses. Anything else that
   * goes wrong is raised.
   */
  remove(id: string): Promise<boolean>
}

/**
 * Whether an identifier can name a replay. Every method that turns a name into
 * an address checks it first: a name let through could become a path outside
 * the media root.
 */
export function isReplayId(id: string): boolean {
  return replayIdSchema.safeParse(id).success
}
