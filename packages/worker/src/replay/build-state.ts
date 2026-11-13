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
 * It is published before anything is collected and again at every transition,
 * so a build interrupted halfway leaves a readable state.
 *
 * Lanes and data sets are counted apart: one lane can store several data sets.
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
      media: { copied: 0, failed: 0, bytes: 0 },
    }
    this.#store = store
    this.#journal = openJournal(store)
    this.#echo = onProgress ?? (() => {})
  }

  /** Checks the manifest against its contract before storing it: the API serves it as stored. */
  async publish(): Promise<void> {
    this.#manifest.updatedAt = now()
    await this.#store.putManifest(replayManifestSchema.parse(this.#manifest))
  }

  /**
   * Names the lanes this build will run, before any of them begins, so a reader
   * following it sees those and no other: a lane whose source was not given
   * never shows as waiting for a turn it will not get.
   */
  plan(lanes: readonly LaneName[]): void {
    for (const lane of lanes) this.#manifest.lanes[lane] = { state: 'pending' }
  }

  /**
   * Runs one lane, and records that it began, ended, or died trying, even in
   * `#begin`: a lane left short of `done` or `failed` reads as a replay that
   * went fine.
   *
   * A failure that cannot be written either stays inside: the manifest in memory
   * already says the lane failed, and {@link settle} writes it whole. Let out, it
   * would skip that very write and leave the replay `running`.
   */
  async runLane<T>(lane: LaneName, collect: () => Promise<T>): Promise<T | undefined> {
    try {
      await this.#begin(lane)
      const collected = await collect()
      await this.#done(lane)
      return collected
    } catch (error) {
      await this.#failed(lane, error).catch((unwritten: unknown) => {
        this.#echo(`  ${lane}: its failure could not be written yet: ${String(unwritten)}`)
      })
      return undefined
    }
  }

  async #begin(lane: LaneName): Promise<void> {
    this.#journal.record(lane, 'started')
    this.#manifest.lanes[lane] = { state: 'running', startedAt: now() }
    await this.publish()
  }

  /**
   * A collector for one data set, whose progress reaches the lane's journal. No
   * request for one that only gathers failures for {@link noteFailures}.
   */
  collectorFor(lane: LaneName, request: Record<string, unknown> = {}): ReportCollector {
    return new ReportCollector(request, {
      onProgress: this.#journal.progressOf(lane, this.#echo),
    })
  }

  /**
   * Stores one data set, once it satisfies its contract: a value the contract
   * refuses fails the lane, so what is stored is served without a second check.
   * The count is given because a data set is not always an array.
   */
  async stored<T>(
    dataset: DatasetName,
    contract: z.ZodType,
    envelope: Envelope<T>,
    count: number,
  ): Promise<void> {
    checkEnvelope(contract, envelope)
    await this.#store.putDataset(dataset, envelope.data, envelope.report)

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

  /** Adds to what the replay has frozen: several lanes freeze media into one tally. */
  async copied(tally: ReplayManifest['media']): Promise<void> {
    const frozen = this.#manifest.media
    this.#manifest.media = {
      copied: frozen.copied + tally.copied,
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
   * Seals the build: waits for the journal, settles the state, publishes once. A
   * journal that could not be written is recorded rather than raised, which
   * would give a stored replay the exit code of a build that could not start.
   */
  async settle(): Promise<BuildResult> {
    try {
      await this.#journal.settled()
    } catch (error) {
      this.#manifest.journalError = error instanceof Error ? error.message : String(error)
      this.#echo(`  the journal could not be written: ${this.#manifest.journalError}`)
    }

    // A planned lane that never began had nothing to work on: a lane upstream
    // failed, and says so.
    for (const [lane, status] of Object.entries(this.#manifest.lanes)) {
      if (status.state === 'pending') delete this.#manifest.lanes[lane as LaneName]
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
   * single failure is complete, anything between is partial.
   */
  #state(): ReplayManifest['state'] {
    const datasets = Object.values(this.#manifest.datasets)
    if (datasets.length === 0) return 'failed'

    const failed =
      // Any lane short of `done`, not only one that reached `failed`.
      Object.values(this.#manifest.lanes).some((lane) => lane.state !== 'done') ||
      datasets.some((dataset) => exitCodeFor(dataset.report) !== ExitCode.success) ||
      this.#manifest.media.failed > 0 ||
      this.#manifest.journalError !== undefined
    return failed ? 'partial' : 'complete'
  }
}
