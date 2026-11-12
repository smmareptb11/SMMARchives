import { z } from 'zod'

import { instantSchema, timeWindowSchema } from '../clock.ts'
import { reportSchema } from '../envelope.ts'
import { boundingBoxSchema } from './geometry.ts'
import { thresholdNatureSchema } from './threshold.ts'

/**
 * The identifier of a replay: the UUID the database minted for it, lower case
 * as PostgreSQL writes it.
 *
 * Nothing else is one. It names a directory of media and a path segment of the
 * API, so a separator or a space in it would escape both — and a name the
 * database could never have minted is refused here rather than looked up.
 */
export const replayIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'must be the identifier the database minted',
  )

/**
 * One stored data set of a replay.
 *
 * Each name is a stored file and will be an API route. A collection that no
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
 * produces.
 *
 * `aquasys` carries three because they come from one host and one referential,
 * and `lizmap` two because they come from one host. `events`
 * and `media` read no source at all: they work on what the others returned, and
 * they are lanes so that a failure in one of them stays theirs. What must stay sequential is an access, not a subject.
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

/**
 * An empty replay is a success and a truncated one is not — the same rule a
 * report follows with the exit code it implies.
 */
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
 * What an administrator says of a replay as it is constituted, each optional.
 *
 * Not part of its identity: a build needs none of it, and none of it reaches
 * the build.
 */
export const replayAboutSchema = z.object({
  description: z.string().optional(),
  phenomenon: phenomenonSchema.optional(),
  severity: severitySchema.optional(),
})

export type ReplayAbout = z.infer<typeof replayAboutSchema>

/**
 * One family of the fleet, and how much of it spoke.
 *
 * Per family because the two number their sources independently, and a reader
 * told « 263 stations » would count the rain gauges among them.
 */
const fleetCountSchema = z.object({
  inExtent: z.number().int().nonnegative(),
  withMeasures: z.number().int().nonnegative(),
})

/**
 * What a replay holds and how it came to hold it.
 *
 * The index of the replay: the API serves it without reading a single data set,
 * and the administration reads the state and the reports from it rather than
 * replaying the build.
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
   * The fleet of the replay, and how much of it spoke.
   *
   * Deduced from the measures, never from referential dates, which are not
   * reliable on this source. Sources that answered nothing are
   * kept — an absence has to be explainable — so the two counts are what says
   * the difference. Absent until a lane collects a referential.
   */
  fleet: z
    .object({
      hydro: fleetCountSchema,
      'rain-gauge': fleetCountSchema,
    })
    .optional(),
  /**
   * The facts the replay's own data implied.
   *
   * Absent until the crossings are derived, which needs both the thresholds and
   * the measures — so absent on a replay built without the Aquasys lane. The
   * thresholds set aside are counted per nature because a nature is a reason:
   * a flood mark would invent a crossing at every historical high-water mark.
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
   * The radar rainfall images the replay holds, over every series.
   *
   * Not the count of `radar-rainfall`, which is an array of series. Absent
   * unless that data set was collected.
   */
  radarFrames: z.number().int().nonnegative().optional(),
  /**
   * Why the journal is incomplete, when it could not be written.
   *
   * Here rather than in the journal itself, which is precisely what was
   * unavailable. A replay whose trace was lost is incomplete; the data it
   * stored is not affected.
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
