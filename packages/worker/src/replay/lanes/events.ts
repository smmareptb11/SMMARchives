import { z } from 'zod'

import { eventSchema, type Measure, type Station, type Threshold } from '@smmarchives/shared'

import type { ReplayBuild } from '../build-state.ts'
import { deriveCrossings } from '../crossings.ts'

export type Derivable = {
  measures: readonly Measure[]
  thresholds: readonly Threshold[]
  stations: readonly Station[]
}

/**
 * Derives the facts a replay's own data implies, and stores them. It runs on
 * what the collection returned, not on what storage holds, so a replay whose
 * Aquasys lane did not run derives nothing.
 */
export async function deriveEvents(build: ReplayBuild, data: Derivable): Promise<void> {
  await build.runLane('events', async () => {
    const collector = build.collectorFor('events', {
      thresholds: data.thresholds.length,
      stations: data.stations.length,
    })
    const { events, setAside, singleStep } = deriveCrossings({ ...data, collector })

    await build.stored(
      'events',
      z.array(eventSchema),
      { data: events, report: collector.seal({ setAside, singleStep }) },
      events.length,
    )
    await build.derived({ crossings: events.length, singleStep, thresholdsSetAside: setAside })
  })
}
