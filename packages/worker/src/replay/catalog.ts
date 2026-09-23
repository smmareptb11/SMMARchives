import { replayIdSchema, type ReplayIdentity, type ReplayManifest } from '@smmarchives/shared'

import type { ReplayStore } from './store.ts'

/**
 * The level above one replay: what exists, and how to reach it.
 *
 * A build never needed it — it is given its own identity. Everything else
 * does: a listing, a way to tell an unknown replay from an empty one, and a
 * way to take one away.
 */
export type ReplayCatalog = {
  /**
   * Mints a replay, and the identity that names it.
   *
   * The identity of a stored object belongs to what stores it: no client names
   * a replay, so none can collide with another, and no name has to be refused.
   */
  create(identity: Omit<ReplayIdentity, 'id'>): Promise<{ id: string; store: ReplayStore }>
  list(): Promise<ReplayManifest[]>
  /** Undefined on a replay that does not exist. A read never creates one. */
  open(id: string): Promise<ReplayStore | undefined>
  /**
   * Removes a replay whole, or answers that there was nothing to remove.
   *
   * Everything it held goes with it: the manifest, the data sets, the journal
   * and the frozen media. There is nothing to keep — a replay is a copy, and
   * what it copied is either still at its source or gone from it.
   *
   * `false` covers two cases, and only two: no replay by that name, and a
   * name {@link isReplayId} refuses — which an implementation never turns
   * into an address. Anything else that goes wrong is raised.
   */
  remove(id: string): Promise<boolean>
}

/**
 * Checks an identifier against the rule that keeps the catalogue a seam.
 *
 * The port's own invariant, like {@link relativeMediaPath}: a name it let
 * through would become a path outside the root, and a database adapter has no
 * file system to make the violation obvious. Every method that turns a name
 * into an address goes through it.
 */
export function isReplayId(id: string): boolean {
  return replayIdSchema.safeParse(id).success
}
