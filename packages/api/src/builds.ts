import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type { BoundingBox, ReplayIdentity } from '@smmarchives/shared'

/** How a build ended, and what it said if it never got started. */
type BuildHandle = {
  exited: Promise<{ code: number | null; stderr: string }>
}

/** The seam a test replaces: no test starts a real collection. */
export type BuildLauncher = (identity: ReplayIdentity) => BuildHandle

/**
 * Resolved from this file, so the API must run from the checkout: a hoisted
 * `tsx` at the root, the worker's sources beside the API's. An install with
 * `--omit=dev` has neither, and no build would spawn.
 */
const CHECKOUT = fileURLToPath(new URL('../../..', import.meta.url))
export const RUNNER = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url))
export const SCRIPT = fileURLToPath(
  new URL('../../worker/src/scripts/build-replay.ts', import.meta.url),
)

/** What is kept of a child's stderr — enough to say why it gave up. */
export const STDERR_KEPT = 8_192

/**
 * The flags `build-replay` reads, each as `--name=value` rather than two words:
 * strict `parseArgs` refuses a value beginning with a dash, which an extent west
 * of Greenwich has.
 */
export function buildArguments(identity: ReplayIdentity): string[] {
  return [
    `--id=${identity.id}`,
    `--from=${identity.period.from}`,
    `--to=${identity.period.to}`,
    ...(identity.label === null ? [] : [`--label=${identity.label}`]),
    ...(identity.extent === null ? [] : [`--bbox=${toBbox(identity.extent)}`]),
    ...(identity.territory === undefined ? [] : [`--territory=${identity.territory}`]),
  ]
}

/** The order `parseBoundingBox` reads, which is the order `--bbox` declares. */
function toBbox(extent: BoundingBox): string {
  return [extent.minLon, extent.minLat, extent.maxLon, extent.maxLat].join(',')
}

export const spawnBuild: BuildLauncher = (identity) => {
  // Detached, so a restart of the API does not kill a collection; a container
  // restart still does. Its trace is the journal, not this process.
  const child = spawn(RUNNER, ['--env-file-if-exists=.env', SCRIPT, ...buildArguments(identity)], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    // Fixed, not inherited: `--env-file-if-exists` is read against it, and from
    // `packages/api` it would load no `.env`, silently.
    cwd: CHECKOUT,
  })
  child.unref()
  return watch(child)
}

/**
 * Follows a child until its output is in, not merely until it is gone: `close`
 * rather than `exit`, which may come before the last of stderr, where a build
 * that could not start says why.
 */
export function watch(child: ChildProcess): BuildHandle {
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    // Sliced, so a single large chunk cannot run past the limit.
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
 * The builds this instance started, in memory: a replay's state lives on its
 * manifest, and this only refuses a second build, or a deletion, while one runs.
 */
export class BuildRegistry {
  readonly #running = new Set<string>()
  readonly #launch: BuildLauncher

  constructor(launch: BuildLauncher) {
    this.#launch = launch
  }

  /**
   * Claims an identifier, or answers that someone else holds it. Synchronous on
   * purpose: asking then starting leaves a gap two requests fit through.
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
    let handle: BuildHandle
    try {
      handle = this.#launch(identity)
    } catch (error) {
      // Nothing runs, so nothing holds the identifier any more.
      this.release(identity.id)
      throw error
    }
    // Released either way, the rejection caught: left uncaught, it would take
    // the process down.
    handle.exited.then(
      () => this.release(identity.id),
      () => this.release(identity.id),
    )
    return handle
  }
}
