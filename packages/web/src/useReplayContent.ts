import { useEffect, useMemo, useState } from 'react'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { Measure } from '@smmarchives/shared/contracts/measure.ts'
import type { RadarRainfallSeries } from '@smmarchives/shared/contracts/radar-rainfall.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'
import type { RainGauge, Station } from '@smmarchives/shared/contracts/station.ts'
import type { Threshold } from '@smmarchives/shared/contracts/threshold.ts'
import type { FrozenWebcamImage, Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { api } from './api.ts'
import type { ContentChanges } from './events/ReportPanel.tsx'
import { describe } from './problems.ts'
import { gaugesOf } from './rain.ts'
import type { ReplayContent } from './tracks/lanes.ts'

type Loaded = { content: ReplayContent | undefined; failure: string | undefined }

/** How one data set is read, narrowed by a filter: the API's, or a test's own. */
export type Ask = (name: string, filter: Record<string, string>) => Promise<unknown>

/** Every data set the screen rests on, asked for at once and put together. */
export async function contentOf(manifest: ReplayManifest, ask: Ask): Promise<ReplayContent> {
  const { datasets } = manifest
  // A data set no lane produced is not asked for: the manifest says which, and
  // the API would refuse rather than answer an empty list.
  const askFor = async <T>(name: string, fallback: T, filter: Record<string, string> = {}) =>
    datasets[name as keyof typeof datasets] === undefined
      ? fallback
      : ((await ask(name, filter)) as T)

  const [fleet, events, thresholds, rainfall, measured, webcams, images, series] =
    await Promise.all([
      askFor<{ stations: Station[]; rainGauges: RainGauge[] }>('stations', {
        stations: [],
        rainGauges: [],
      }),
      askFor<ReplayEvent[]>('events', []),
      askFor<Threshold[]>('thresholds', []),
      askFor<Measure[]>('measures', [], { family: 'rain-gauge', quantity: 'rainfall' }),
      askFor<number[]>('measured-stations', []),
      askFor<Webcam[]>('webcams', []),
      askFor<FrozenWebcamImage[]>('webcam-images', []),
      askFor<RadarRainfallSeries[]>('radar-rainfall', []),
    ])

  return {
    period: manifest.period,
    ...fleet,
    events,
    thresholds,
    // `askFor` answers an empty list for a data set never produced: told apart
    // here, so that no reader downstream asks the manifest again.
    rain: datasets.measures === undefined ? undefined : gaugesOf(rainfall),
    measuredStations: datasets['measured-stations'] === undefined ? undefined : new Set(measured),
    webcams,
    images,
    series,
  }
}

/**
 * Loads what the screen rests on, and nothing else. A station's measures, by far
 * the heaviest, are not among it: they are read when its bubble opens, one
 * quantity at a time. The parc's rain, much lighter, is.
 */
export function useContent(manifest: ReplayManifest): Loaded & { changes: ContentChanges } {
  const [loaded, setLoaded] = useState<Loaded>({ content: undefined, failure: undefined })
  // What an agent changed, held without reloading the replay: the API said what.
  const changes = useMemo<ContentChanges>(() => {
    const withEvents = (change: (events: ReplayEvent[]) => ReplayEvent[]) => {
      setLoaded((held) =>
        held.content === undefined
          ? held
          : { ...held, content: { ...held.content, events: change(held.content.events) } },
      )
    }
    return {
      // The API answered with the event as a reader will read it.
      saved: (event) => {
        withEvents((events) => withEvent(events, event))
      },
      removed: (id) => {
        withEvents((events) => events.filter((one) => one.id !== id))
      },
    }
  }, [])

  useEffect(() => {
    const leaving = new AbortController()

    const ask: Ask = (name, filter) => api.datasetOf(manifest.id, name, filter, leaving.signal)
    contentOf(manifest, ask).then(
      (content) => {
        setLoaded({ content, failure: undefined })
      },
      (error: unknown) => {
        // A replay left for another drops its requests rather than its answers;
        // the abort that comes back says nothing.
        if (!leaving.signal.aborted) setLoaded({ content: undefined, failure: describe(error) })
      },
    )

    return () => {
      leaving.abort()
    }
    // Three fields read, the same three watched. Watching `manifest` would reload every data
    // set whenever anything else on it moved — its state, its journal — which narrowing avoids.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fields read, not the manifest
  }, [manifest.id, manifest.datasets, manifest.period])

  return { ...loaded, changes }
}

/** The events with this one in, replacing the one of the same name if there was one. */
export function withEvent(events: readonly ReplayEvent[], event: ReplayEvent): ReplayEvent[] {
  return [...events.filter((one) => one.id !== event.id), event]
}
