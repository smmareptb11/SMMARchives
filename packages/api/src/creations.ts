import express, { type Express } from 'express'
import { z } from 'zod'

import {
  ExitCode,
  boundingBoxSchema,
  encloses,
  SMMAR_TERRITORY,
  periodOf,
  phenomenonSchema,
  severitySchema,
  type ReplayIdentity,
  type ReplayManifest,
} from '@smmarchives/shared'
import { isUnion } from '@smmarchives/shared/reference/perimeters.ts'
import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'

import type { BuildRegistry } from './builds.ts'
import { badRequest, describe as describeError, internalError, refusalsIn } from './problems.ts'

/**
 * What a creation accepts: what a replay is about, and nothing a build derives,
 * not even an identifier, which the store gives.
 *
 * The period goes through `periodOf`, which orders it and puts it on the single
 * clock: compared as strings, `00:00:00.500Z → 00:00:00Z` would pass.
 */
const creationSchema = z
  .strictObject({
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
    // Served back on every card: line breaks, but no other control character.
    description: z
      .string()
      .max(2000)
      .regex(
        /^(?:[^\p{Cc}]|[\n\r\t])*$/u,
        'must not carry control characters other than line breaks',
      )
      .transform((value) => value.trim())
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    phenomenon: phenomenonSchema.optional(),
    severity: severitySchema.optional(),
    // One of the unions the form lists, or a client could print any text on a card.
    territory: z.string().refine(isUnion, { message: 'must name a basin union' }).optional(),
    period: z.object({ from: z.string(), to: z.string() }).transform((period, context) => {
      let window
      try {
        window = periodOf(period.from, period.to)
      } catch {
        // Its own message, not the shared one: `parseInstant` quotes what it
        // was given, and no response body repeats a client's text.
        context.addIssue({ code: 'custom', message: 'must be two instants, in order and apart' })
        return z.NEVER
      }
      // Nothing has been measured yet past now: such a replay would be hollow.
      if (Date.parse(window.to) > Date.now()) {
        context.addIssue({ code: 'custom', message: 'must not end in the future' })
        return z.NEVER
      }
      return window
    }),
  })
  // A union names the rectangle framed on it: the whole fleet is no union's.
  .refine((creation) => creation.territory === undefined || creation.extent !== null, {
    message: 'must come with an extent',
    path: ['territory'],
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

    const { description, phenomenon, severity, ...identity } = parsed.data
    const about = {
      ...(description === undefined ? {} : { description }),
      ...(phenomenon === undefined ? {} : { phenomenon }),
      ...(severity === undefined ? {} : { severity }),
    }
    const { id } = await routes.catalog.create(identity, about)
    // A freshly minted identifier: nothing else can hold it, and the claim is
    // what stops a deletion while the build is under way.
    routes.builds.reserve(id)
    await answer(routes, res, { id, ...identity })
  })
}

/**
 * Runs the build and waits only for the news that changes the answer: a build
 * that could not start at all, whose empty replay must not be left behind.
 */
async function answer(
  routes: CreationRoutes,
  res: express.Response,
  identity: ReplayIdentity,
): Promise<void> {
  let handle
  try {
    handle = routes.builds.start(identity)
  } catch (error) {
    await couldNotStart(routes, res, identity.id, describeError(error))
    return
  }
  const stopped = await Promise.race([
    handle.exited,
    new Promise<undefined>((settle) => setTimeout(() => settle(undefined), routes.publishTimeout)),
  ])

  // Only a build that could not run leaves nothing worth keeping. One that
  // settled partial or failed has written a replay and the journal of why.
  if (stopped !== undefined && (stopped.code === null || stopped.code === ExitCode.failure)) {
    await couldNotStart(routes, res, identity.id, describe(stopped))
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

/** Takes away the replay a build never filled, and says why in the log alone. */
async function couldNotStart(
  routes: CreationRoutes,
  res: express.Response,
  id: string,
  why: string,
): Promise<void> {
  routes.log(`build ${id} could not start: ${why}`)
  await routes.catalog.remove(id)
  // The request was valid — this API checked it — so the fault is not the
  // client's to correct.
  internalError(res, 'the build could not be started; the server log says why')
}

function describe(result: { code: number | null; stderr: string }): string {
  return `exit ${result.code ?? 'none'}: ${result.stderr.trim()}`
}

async function manifestOf(catalog: ReplayCatalog, id: string): Promise<ReplayManifest | undefined> {
  return (await catalog.open(id))?.getManifest()
}
