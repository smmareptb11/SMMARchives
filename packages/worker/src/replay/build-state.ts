import type { z } from 'zod'

import {
  ExitCode,
  ReportCollector,
  checkEnvelope,
  exitCodeFor,
  replayManifestSchema,
  type DatasetName,
  type Envelope,
  type Instant,
  type LaneName,
  type ReplayIdentity,
  type ReplayManifest,
} from '@smmarchives/shared'

import { openJournal, type Journal } from './journal.ts'
import type { ReplayStore } from './store.ts'

export type BuildResult = {
  manifest: ReplayManifest
  exitCode: ExitCode
}

/** The single clock, read at the moment a transition happens. */
function now(): Instant {
  return new Date().toISOString()
}

/**
 * The state of a build in progress, and the only thing that writes the manifest.
 *
 * The manifest is published before anything is collected and again at every
 * transition, so a build interrupted halfway leaves a readable state instead of
 * a directory nobody can interpret.
 *
 * A lane and a data set are counted separately because they are not the same
 * thing: the Aquasys lane produces four data sets off one referential, each
 * with the report of the script or the derivation it corresponds to.
 */
export class ReplayBuild {
  readonly #manifest: ReplayManifest
  readonly #store: ReplayStore
  readonly #journal: Journal
  readonly #echo: (message: string) => void

  constructor(
    identity: ReplayIdentity,
    store: ReplayStore,
    onProgress: ((message: string) => void) | undefined,
  ) {
    const at = now()
    this.#manifest = {
      schemaVersion: 1,
      ...identity,
      createdAt: at,
      updatedAt: at,
      state: 'running',
      lanes: {},
      datasets: {},
      media: { copied: 0, skipped: 0, failed: 0, bytes: 0 },
    }
    this.#store = store
    this.#journal = openJournal(store)
    this.#echo = onProgress ?? (() => {})
  }

  /**
   * Checks the manifest against its own contract before storing it.
   *
   * The manifest is the index the API will serve and the administration will
   * read; a bound declared on it and never run is how a longitude of 1000
   * reached production once already. It is written a handful of times per
   * build, so the check costs nothing measurable.
   */
  async publish(): Promise<void> {
    this.#manifest.updatedAt = now()
    await this.#store.putManifest(replayManifestSchema.parse(this.#manifest))
  }

  /**
   * Runs one lane, and records that it began, ended, or died trying.
   *
   * The transitions are here rather than left to each lane because a lane that
   * reached neither `done` nor `failed` reads as a replay that went fine: it is
   * not counted as a failure, and a build that never reached {@link settle}
   * leaves the manifest frozen mid-transition. Both happened. Wrapped, a lane
   * cannot represent that state — including a lane that dies in `#begin`, whose
   * first act is a disk write.
   */
  async runLane<T>(lane: LaneName, collect: () => Promise<T>): Promise<T | undefined> {
    try {
      await this.#begin(lane)
      const collected = await collect()
      await this.#done(lane)
      return collected
    } catch (error) {
      await this.#failed(lane, error)
      return undefined
    }
  }

  async #begin(lane: LaneName): Promise<void> {
    this.#journal.record(lane, 'started')
    this.#manifest.lanes[lane] = { state: 'running', startedAt: now() }
    await this.publish()
  }

  /** A collector for one data set, whose progress reaches the lane's journal. */
  collectorFor(lane: LaneName, script: string, request: Record<string, unknown>): ReportCollector {
    return new ReportCollector(script, request, {
      onProgress: this.#journal.progressOf(lane, this.#echo),
    })
  }

  /**
   * Stores one data set, once it satisfies the contract its collector declares.
   *
   * A value its own contract refuses fails the lane rather than reaching
   * storage: the API and the interface import these schemas, so what is stored
   * can be served without being checked again.
   *
   * The count is given rather than derived: a data set is not always an array —
   * the referential is one object holding two families.
   */
  async stored<T>(
    dataset: DatasetName,
    contract: z.ZodType,
    envelope: Envelope<T>,
    count: number,
  ): Promise<void> {
    checkEnvelope(contract, envelope)
    await this.#store.putDataset(dataset, envelope.data)

    this.#manifest.datasets[dataset] = {
      count,
      report: envelope.report,
    }
    await this.publish()
  }

  /** What the replay's own data implied, once derived. */
  async derived(events: NonNullable<ReplayManifest['events']>): Promise<void> {
    this.#manifest.events = events
    await this.publish()
  }

  /** The fleet the replay rests on, and how much of it returned measures. */
  async counted(fleet: NonNullable<ReplayManifest['fleet']>): Promise<void> {
    this.#manifest.fleet = fleet
    await this.publish()
  }

  /**
   * Adds to what the replay has frozen.
   *
   * Accumulated rather than replaced: two lanes freeze media now — the rasters
   * a delivery holds and the webcam images Ceneau would purge — and the tally
   * answers one question for the replay, not one per lane.
   */
  async copied(tally: ReplayManifest['media']): Promise<void> {
    const frozen = this.#manifest.media
    this.#manifest.media = {
      copied: frozen.copied + tally.copied,
      skipped: frozen.skipped + tally.skipped,
      failed: frozen.failed + tally.failed,
      bytes: frozen.bytes + tally.bytes,
    }
    await this.publish()
  }

  /** Failures with no data set to carry them, which is what media are. */
  async noteFailures(lane: LaneName, collector: ReportCollector): Promise<void> {
    for (const failure of collector.seal().failures) {
      this.#journal.record(lane, 'failed', `${failure.subject}: ${failure.message}`)
    }
    await this.publish()
  }

  async #done(lane: LaneName): Promise<void> {
    this.#manifest.lanes[lane] = {
      ...this.#manifest.lanes[lane],
      state: 'done',
      finishedAt: now(),
    }
    this.#journal.record(lane, 'done')
    await this.publish()
  }

  async #failed(lane: LaneName, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    this.#journal.record(lane, 'failed', message)
    this.#manifest.lanes[lane] = {
      ...this.#manifest.lanes[lane],
      state: 'failed',
      finishedAt: now(),
      error: message,
    }
    await this.publish()
  }

  /**
   * Seals the build: waits for the journal, settles the state, publishes once.
   *
   * A journal that could not be written is recorded rather than raised. Raised,
   * it would leave a complete replay on disk behind an exit code documented as
   * "could not start" — the manifest and the command contradicting each other.
   */
  async settle(): Promise<BuildResult> {
    try {
      await this.#journal.settled()
    } catch (error) {
      this.#manifest.journalError = error instanceof Error ? error.message : String(error)
      this.#echo(`  the journal could not be written: ${this.#manifest.journalError}`)
    }

    this.#manifest.state = this.#state()
    await this.publish()

    return {
      manifest: this.#manifest,
      exitCode: this.#manifest.state === 'complete' ? ExitCode.success : ExitCode.partial,
    }
  }

  /**
   * A replay that stored nothing is failed, one that stored everything without a
   * single failure is complete, anything between is partial — the ladder the
   * collection scripts express through their exit codes.
   */
  #state(): ReplayManifest['state'] {
    const datasets = Object.values(this.#manifest.datasets)
    if (datasets.length === 0) return 'failed'

    const failed =
      // Any lane short of `done`, not only one that reached `failed`. With
      // `runLane` there should be none, which is what makes this a net rather
      // than the only thing standing between a dead lane and a `complete`.
      Object.values(this.#manifest.lanes).some((lane) => lane.state !== 'done') ||
      // The same rule the scripts apply to their own exit code, read from the
      // one place that states it.
      datasets.some((dataset) => exitCodeFor(dataset.report) !== ExitCode.success) ||
      this.#manifest.media.failed > 0 ||
      this.#manifest.journalError !== undefined
    return failed ? 'partial' : 'complete'
  }
}
