import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type { BoundingBox, ReplayIdentity } from '@smmarchives/shared'

/** How a build ended, and what it said if it never got started. */
export type BuildHandle = {
  exited: Promise<{ code: number | null; stderr: string }>
}

/** The seam a test replaces: no test starts a real collection. */
export type BuildLauncher = (identity: ReplayIdentity) => BuildHandle

/**
 * Resolved from this file, which assumes the API runs from the checkout: the
 * workspaces and a hoisted `tsx` at the root, and the worker's sources beside
 * the API's. A packaged install with `--omit=dev` has neither, and a build
 * would then fail to spawn on every request.
 */
const CHECKOUT = fileURLToPath(new URL('../../..', import.meta.url))
export const RUNNER = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url))
export const SCRIPT = fileURLToPath(
  new URL('../../worker/src/scripts/build-replay.ts', import.meta.url),
)

/** What is kept of a child's stderr — enough to say why it gave up. */
export const STDERR_KEPT = 8_192

/**
 * The flags `build-replay` reads, each as `--name=value`.
 *
 * Not as two words: `parseArgs` runs strict, and refuses a value beginning
 * with a dash as ambiguous. An extent west of Greenwich — which the API
 * validates and accepts — would otherwise fail every build it starts, with
 * the reason confined to the server log.
 */
export function buildArguments(identity: ReplayIdentity): string[] {
  return [
    `--id=${identity.id}`,
    `--from=${identity.period.from}`,
    `--to=${identity.period.to}`,
    ...(identity.label === null ? [] : [`--label=${identity.label}`]),
    ...(identity.extent === null ? [] : [`--bbox=${toBbox(identity.extent)}`]),
  ]
}

/** The order `parseBoundingBox` reads, which is the order `--bbox` declares. */
function toBbox(extent: BoundingBox): string {
  return [extent.minLon, extent.minLat, extent.maxLon, extent.maxLat].join(',')
}

export const spawnBuild: BuildLauncher = (identity) => {
  // Detached: a restart of the API must not kill a collection that runs for
  // minutes. Its trace is the journal, not this process.
  const child = spawn(RUNNER, ['--env-file-if-exists=.env', SCRIPT, ...buildArguments(identity)], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    // Fixed, not inherited: `--env-file-if-exists` is read against it, and a
    // working directory of `packages/api` would load no `.env` at all — the
    // `-if-exists` suffix means it would not say so either, and every build
    // would then die on a variable the operator had set.
    cwd: CHECKOUT,
  })
  child.unref()
  return watch(child)
}

/**
 * Follows a child until its output is in, not merely until it is gone.
 *
 * `close` rather than `exit`: only the first is emitted once the pipes are
 * closed. What a build that refused to start wrote last is the whole reason it
 * did, and `exit` makes no promise about having delivered it.
 */
export function watch(child: ChildProcess): BuildHandle {
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    // Sliced rather than skipped: appending a whole chunk once under the
    // limit let a single 64 kB burst through it.
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, STDERR_KEPT)
  })

  return {
    exited: new Promise((settle) => {
      child.once('error', (error) => settle({ code: 1, stderr: `${stderr}${error.message}` }))
      child.once('close', (code) => settle({ code, stderr }))
    }),
  }
}

/**
 * The builds this instance started.
 *
 * In memory on purpose: a replay's state lives on its manifest, and this only
 * answers what is running here — enough to refuse a second build of the same
 * replay, and a deletion while one is under way.
 */
export class BuildRegistry {
  readonly #running = new Set<string>()
  readonly #launch: BuildLauncher

  constructor(launch: BuildLauncher) {
    this.#launch = launch
  }

  /**
   * Claims an identifier, or answers that someone else holds it.
   *
   * Synchronous on purpose, and before anything is awaited: asking then
   * starting leaves a gap two requests fit through, and each one that does
   * spawns a collection against the same sources and the same directory.
   */
  reserve(id: string): boolean {
    if (this.#running.has(id)) return false
    this.#running.add(id)
    return true
  }

  release(id: string): void {
    this.#running.delete(id)
  }

  /** Starts a build on an identifier already reserved. */
  start(identity: ReplayIdentity): BuildHandle {
    const handle = this.#launch(identity)
    // Let go whatever happened, and never on a rejection nobody catches: a
    // launcher that throws would otherwise take the process down.
    handle.exited.then(
      () => this.release(identity.id),
      () => this.release(identity.id),
    )
    return handle
  }
}
