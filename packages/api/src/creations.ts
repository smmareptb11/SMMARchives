import express, { type Express } from 'express'
import { z } from 'zod'

import {
  boundingBoxSchema,
  encloses,
  SMMAR_TERRITORY,
  windowOf,
  type ReplayIdentity,
  type ReplayManifest,
} from '@smmarchives/shared'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'

import type { BuildRegistry } from './builds.ts'
import { badRequest, internalError, refusalsIn } from './problems.ts'

/**
 * What a creation accepts: what a replay is about, and nothing a build derives.
 *
 * No identifier: a replay is named by what stores it, so a client cannot pick
 * a name, cannot collide with another, and never has one refused.
 *
 * The period goes through `windowOf`, the one place that orders a window: the
 * shared schema does not, and comparing the two instants as strings would let
 * `00:00:00.500Z → 00:00:00Z` through, `.` sorting before `Z`. It also
 * normalises them onto the single clock, so what a build receives is what a
 * manifest will carry.
 */
const creationSchema = z.strictObject({
  // Bounded and printable: it becomes a command-line argument, where a null
  // byte makes `spawn` throw, and it is served back with every listing.
  label: z
    .string()
    .max(200)
    .regex(/^[^\p{Cc}]*$/u, 'must not carry control characters')
    .nullish()
    .transform((value) => value ?? null),
  // Refused rather than cut: a build of less than was asked would say nothing
  // of what it left out.
  extent: boundingBoxSchema
    .refine((extent) => encloses(SMMAR_TERRITORY, extent), {
      message: 'must lie within the SMMAR territory',
    })
    .nullish()
    .transform((value) => value ?? null),
  period: z.object({ from: z.string(), to: z.string() }).transform((period, context) => {
    try {
      return windowOf(period.from, period.to)
    } catch {
      // Its own message, not the shared one: `parseInstant` quotes what it
      // was given, and no response body repeats a client's text.
      context.addIssue({ code: 'custom', message: 'must be two instants, in order' })
      return z.NEVER
    }
  }),
})

export type CreationRoutes = {
  catalog: ReplayCatalog
  builds: BuildRegistry
  /** How long a creation waits to see whether the build could start at all. */
  publishTimeout: number
  /** Where a build's own diagnostic goes, since no response may carry it. */
  log: (message: string) => void
}

export function registerCreation(app: Express, routes: CreationRoutes): void {
  app.post('/replays', express.json({ limit: '64kb' }), async (req, res) => {
    const parsed = creationSchema.safeParse(req.body)
    if (!parsed.success) {
      badRequest(res, 'the replay to build is not described correctly', refusalsIn(parsed.error))
      return
    }

    const { id } = await routes.catalog.create(parsed.data)
    // A freshly minted identifier: nothing else can hold it, and the claim is
    // what stops a deletion while the build is under way.
    routes.builds.reserve(id)
    await answer(routes, res, { id, ...parsed.data })
  })
}

/**
 * Runs the build and waits only for the news that changes the answer.
 *
 * The replay exists the moment it is created, so a creation has no need to wait
 * to hear that one does: what is worth waiting for is a build that could not
 * start at all — a missing token, an unreachable volume — because the replay it
 * would have filled must not be left behind as an empty one.
 */
async function answer(
  routes: CreationRoutes,
  res: express.Response,
  identity: ReplayIdentity,
): Promise<void> {
  const handle = routes.builds.start(identity)
  const stopped = await Promise.race([
    handle.exited,
    new Promise<undefined>((settle) => setTimeout(() => settle(undefined), routes.publishTimeout)),
  ])

  if (stopped !== undefined && stopped.code !== 0) {
    routes.log(`build ${identity.id} could not start: ${describe(stopped)}`)
    await routes.catalog.remove(identity.id)
    // The request was valid — this API checked it — so the fault is not the
    // client's to correct.
    internalError(res, 'the build could not be started; the server log says why')
    return
  }

  const manifest = await manifestOf(routes.catalog, identity.id)
  if (manifest === undefined) {
    routes.log(`build ${identity.id} lost its replay before it could be served`)
    internalError(res, 'the replay could not be read back; the server log says why')
    return
  }
  res.status(201).location(`/replays/${identity.id}`).json(manifest)
}

function describe(result: { code: number | null; stderr: string }): string {
  return `exit ${result.code ?? 'none'}: ${result.stderr.trim()}`
}

async function manifestOf(catalog: ReplayCatalog, id: string): Promise<ReplayManifest | undefined> {
  return (await catalog.open(id))?.getManifest()
}
