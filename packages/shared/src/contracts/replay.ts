import { z } from 'zod'

import { instantSchema, timeWindowSchema } from '../clock.ts'
import { reportSchema } from '../envelope.ts'
import { boundingBoxSchema } from './geometry.ts'
import { thresholdNatureSchema } from './threshold.ts'

/**
 * The identifier of a replay: the UUID the database minted for it, lower case
 * as PostgreSQL writes it. It names a media directory and an API path segment,
 * so anything else is refused here rather than looked up.
 */
export const replayIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'must be the identifier the database minted',
  )

/**
 * One stored data set of a replay, each name an API route. A collection no
 * replay writes yet has no name here: the manifest describes what a replay
 * holds, never what it might one day hold.
 */
export const datasetNameSchema = z.enum([
  'events',
  'stations',
  'thresholds',
  'measures',
  'measured-stations',
  'webcams',
  'webcam-images',
  'radar-rainfall',
])

export type DatasetName = z.infer<typeof datasetNameSchema>

/**
 * One strand of the build, named after what it reads rather than what it
 * produces: what must stay sequential is an access to a host, not a subject.
 * `events` and `media` read no source, and are lanes so that a failure in one
 * of them stays theirs.
 */
export const laneNameSchema = z.enum(['aquasys', 'lizmap', 'radar-rainfall', 'events', 'media'])

export type LaneName = z.infer<typeof laneNameSchema>

export const laneStateSchema = z.enum(['pending', 'running', 'done', 'failed'])

export const laneStatusSchema = z.object({
  state: laneStateSchema,
  startedAt: instantSchema.optional(),
  finishedAt: instantSchema.optional(),
  /** Why a lane stopped before producing anything, which no data set can say. */
  error: z.string().optional(),
})

export const datasetStatusSchema = z.object({
  count: z.number().int().nonnegative(),
  report: reportSchema,
})

export type DatasetStatus = z.infer<typeof datasetStatusSchema>

export const mediaTallySchema = z.object({
  copied: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
})

export type MediaTally = z.infer<typeof mediaTallySchema>

/** An empty replay is `complete`; a truncated one is `partial`. */
export const replayStateSchema = z.enum(['running', 'complete', 'partial', 'failed'])

export const replayIdentitySchema = z.object({
  id: replayIdSchema,
  label: z.string().nullable(),
  /** Null is the whole SMMAR fleet, which is the territory's own extent. */
  extent: boundingBoxSchema.nullable(),
  /**
   * The basin union the extent was framed on, by the short name a list shows.
   * Absent when the extent is the whole fleet, or a rectangle no union names.
   */
  territory: z.string().optional(),
  period: timeWindowSchema,
})

export type ReplayIdentity = z.infer<typeof replayIdentitySchema>

/** The kind of episode a replay covers, which a list of replays is classed by. */
export const phenomenonSchema = z.enum([
  'flood',
  'intense-rainfall',
  'runoff',
  'marine-submersion',
  'windstorm',
  'other',
])

export type Phenomenon = z.infer<typeof phenomenonSchema>

/**
 * How serious the episode was, on the SMMAR's own ladder: the one its
 * thresholds are named on, lowest first.
 */
export const severitySchema = z.enum(['vigilance', 'alert', 'reinforced-alert', 'crisis'])

export type Severity = z.infer<typeof severitySchema>

/**
 * What an administrator says of a replay as it is constituted, each optional,
 * and nothing a build reads.
 */
export const replayAboutSchema = z.object({
  description: z.string().optional(),
  phenomenon: phenomenonSchema.optional(),
  severity: severitySchema.optional(),
})

export type ReplayAbout = z.infer<typeof replayAboutSchema>

/**
 * One family of the fleet, and how much of it spoke: counted apart, or the rain
 * gauges would be read as stations.
 */
const fleetCountSchema = z.object({
  inExtent: z.number().int().nonnegative(),
  withMeasures: z.number().int().nonnegative(),
})

/**
 * What a replay holds and how it came to hold it: its index, served without
 * reading a single data set.
 */
export const replayManifestSchema = replayIdentitySchema.extend({
  ...replayAboutSchema.shape,
  schemaVersion: z.literal(1),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  state: replayStateSchema,
  /** When it was opened to everyone. Absent, only the administrator sees it. */
  publishedAt: instantSchema.optional(),
  lanes: z.partialRecord(laneNameSchema, laneStatusSchema),
  datasets: z.partialRecord(datasetNameSchema, datasetStatusSchema),
  media: mediaTallySchema,
  /**
   * The fleet of the replay per family, deduced from the measures and never from
   * referential dates, which this source does not keep reliable. Sources that
   * answered nothing are counted, so an absence can be explained. Absent until a
   * lane collects a referential.
   */
  fleet: z
    .object({
      hydro: fleetCountSchema,
      'rain-gauge': fleetCountSchema,
    })
    .optional(),
  /**
   * The facts the replay's own data implied. Absent until the crossings are
   * derived from the thresholds and the measures, so on a replay built without
   * the Aquasys lane. Thresholds set aside are counted per nature, which is why.
   */
  events: z
    .object({
      crossings: z.number().int().nonnegative(),
      /** Crossings that lasted a single measure — a probe oscillating, most likely. */
      singleStep: z.number().int().nonnegative(),
      thresholdsSetAside: z.partialRecord(thresholdNatureSchema, z.number().int().nonnegative()),
    })
    .optional(),
  /**
   * The radar rainfall images the replay holds over every series, which the
   * count of `radar-rainfall` is not. Absent unless that data set was collected.
   */
  radarFrames: z.number().int().nonnegative().optional(),
  /**
   * Why the journal is incomplete, when it could not be written: here, since the
   * journal is what was unavailable. The data the replay stored is not affected.
   */
  journalError: z.string().optional(),
})

export type ReplayManifest = z.infer<typeof replayManifestSchema>

export const journalEntrySchema = z.object({
  at: instantSchema,
  lane: laneNameSchema,
  kind: z.enum(['started', 'progress', 'failed', 'done']),
  message: z.string().optional(),
})

export type JournalEntry = z.infer<typeof journalEntrySchema>
