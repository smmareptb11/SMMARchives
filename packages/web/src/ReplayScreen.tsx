import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { Measure } from '@smmarchives/shared/contracts/measure.ts'
import type { RadarRainfallSeries } from '@smmarchives/shared/contracts/radar-rainfall.ts'
import type { ReferenceLayer } from '@smmarchives/shared/contracts/reference-layer.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'
import type { RainGauge, Station } from '@smmarchives/shared/contracts/station.ts'
import type { Threshold } from '@smmarchives/shared/contracts/threshold.ts'
import type { FrozenWebcamImage, Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { api } from './api.ts'
import { cursorAt } from './transport/reading.ts'
import { PERIMETERS } from './map/families.ts'
import { paintedAt } from './map/state.ts'
import { extentOf, openingProductOf } from './radar.ts'
import { gaugesOf } from './rain.ts'
import { describe } from './problems.ts'
import { Playhead } from './transport/Playhead.tsx'
import { Transport } from './transport/Transport.tsx'
import { useCursor } from './transport/useCursor.ts'
import { ReplayHeading, TrackList } from './tracks/TrackList.tsx'
import { heldIn, lanesOf, radarFamilyOf, type ReplayContent } from './tracks/lanes.ts'

/**
 * Loaded on the screen that draws one, and on no other.
 *
 * MapLibre and its stylesheet weigh a megabyte of script and eighty kilobytes
 * of style. Imported here, they land in the first chunk, and the creation form
 * — which shows no map — waits for them before it can draw a text field.
 */
const MapView = lazy(async () => ({ default: (await import('./map/MapView.tsx')).MapView }))

/**
 * One replay: the map of what it holds, and the lanes of when it happened.
 *
 * The loading lives here rather than in either view, because both read the same
 * data sets — the crossings that will colour a station are the crossings that
 * draw its segment. Loading them twice would be reading the same thing twice.
 */
export function ReplayScreen({ manifest }: { manifest: ReplayManifest }) {
  const { content, failure } = useContent(manifest)

  if (failure !== undefined) return <p className="refusal">{failure}</p>
  if (content === undefined) return <p>Lecture du rejeu…</p>

  return <Replayed manifest={manifest} content={content} />
}

/**
 * The reading, shared by the map and the lanes.
 *
 * Its own component because the cursor rests on a replay that has arrived: a
 * hook above the loading would have to invent a period for a replay nobody has
 * read yet.
 *
 * Colouring at an instant asks nothing new of the API: a crossing carries its
 * start, its end and its colour, so the same events the lanes draw are what the
 * map paints with.
 */
function Replayed({ manifest, content }: { manifest: ReplayManifest; content: ReplayContent }) {
  const marks = useMemo(() => content.events.map((one) => Date.parse(one.from)), [content.events])
  const reading = useCursor(manifest.period, marks)
  const seek = useCallback(
    (fraction: number) => {
      reading.seek(cursorAt(manifest.period, fraction))
    },
    // `reading.seek` is memoised by `useCursor`; `reading` itself is a new object on every
    // render, so watching it would rebuild this callback sixty times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stable member, not the object
    [reading.seek, manifest.period],
  )
  const colours = useMemo(() => paintedAt(content, reading.at), [content, reading.at])
  // Above the map and the lanes because it reaches both: a replay keeps the
  // sources that answered nothing, and the reader says when to see them.
  const [mutesShown, setMutesShown] = useState(false)
  // Here too, and for the same reason: the map draws one cumul and the lane
  // under it shows the images of that one. Chosen once per replay, out of what
  // the delivery actually carried.
  const [product, setProduct] = useState(() => openingProductOf(content.series))
  // Built here rather than inside the lanes, because the switch's own count is
  // read off them: built twice, the number on the switch and the lanes under it
  // could disagree. On the replay alone, so a click on the switch filters what
  // is built rather than building it again.
  const held = useMemo(() => lanesOf(content), [content])
  // Apart, and `radarFamilyOf` says why: it is the one family a reader's choice
  // moves, and the others must not be rebuilt to follow it.
  const radar = useMemo(() => radarFamilyOf(content, product), [content, product])
  const families = useMemo(() => [...held, ...radar], [held, radar])
  const heldBack = useMemo(() => heldIn(families), [families])

  return (
    <>
      <Transport reading={reading} />
      {/* Nothing while it arrives: a box the height of the map would push the
          lanes down and back up again, and the lanes are readable without it. */}
      <Suspense fallback={null}>
        <MapView
          content={content}
          colours={colours}
          replayId={manifest.id}
          at={reading.at}
          mutesShown={mutesShown}
          onMutesShown={setMutesShown}
          heldBack={heldBack}
          product={product}
          onProduct={setProduct}
        />
      </Suspense>
      <ReplayHeading manifest={manifest} content={content} />

      {/* One positioned wrapper for the two: the bar is laid over the lanes,
          and is the only child of the pair that a tick re-renders. */}
      <div className="tracks">
        <Playhead period={manifest.period} at={reading.at} />
        <TrackList manifest={manifest} families={families} onSeek={seek} mutesShown={mutesShown} />
      </div>
    </>
  )
}

type Loaded = { content: ReplayContent | undefined; failure: string | undefined }

/** Every data set the screen rests on, asked for at once and put together. */
async function contentOf(manifest: ReplayManifest, signal: AbortSignal): Promise<ReplayContent> {
  const { id, datasets } = manifest
  // A data set no lane produced is not asked for: the manifest says which, and
  // the API would refuse rather than answer an empty list.
  const askFor = async <T,>(name: string, fallback: T, filter: Record<string, string> = {}) =>
    datasets[name as keyof typeof datasets] === undefined
      ? fallback
      : api.datasetOf<T>(id, name, filter, signal)

  const [fleet, events, thresholds, rainfall, webcams, images, series, layers] = await Promise.all([
    askFor<{ stations: Station[]; rainGauges: RainGauge[] }>('stations', {
      stations: [],
      rainGauges: [],
    }),
    askFor<ReplayEvent[]>('events', []),
    askFor<Threshold[]>('thresholds', []),
    askFor<Measure[]>('measures', [], { quantity: 'rainfall' }),
    askFor<Webcam[]>('webcams', []),
    askFor<FrozenWebcamImage[]>('webcam-images', []),
    askFor<RadarRainfallSeries[]>('radar-rainfall', []),
    // Only the one the map draws: the four layers together weigh a megabyte,
    // and the perimeters of the communes alone are 26 600 vertices nothing
    // reads. The data set narrows on `layer`, so the filter costs nothing.
    askFor<ReferenceLayer[]>('reference-layers', [], { layer: PERIMETERS }),
  ])

  return {
    period: manifest.period,
    ...fleet,
    events,
    thresholds,
    // Where the flattening is undone, being where it was done: `askFor` answers
    // an empty list for a data set the build never produced, and every reader
    // downstream would otherwise have to ask the manifest the same question.
    rain: datasets.measures === undefined ? undefined : gaugesOf(rainfall),
    webcams,
    images,
    series,
    radarExtent: extentOf(datasets['radar-rainfall']),
    layers,
  }
}

/**
 * Loads what the screen rests on, and nothing else.
 *
 * A station's measures are not among it: a replay of 24 hours holds 19 Mb of
 * them, and what the map and the lanes draw are the crossings the build
 * derived, the media it froze and the layers it copied. They are read when a
 * station's bubble opens, one station and one quantity at a time.
 *
 * The rain of the whole parc is among it, being a fortieth of that on the same
 * replay — so are the ladders that say which quantity a station is read on.
 */
function useContent(manifest: ReplayManifest): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ content: undefined, failure: undefined })

  useEffect(() => {
    const leaving = new AbortController()

    contentOf(manifest, leaving.signal).then(
      (content) => {
        setLoaded({ content, failure: undefined })
      },
      (error: unknown) => {
        // A replay left for another drops its requests rather than its answers:
        // one of them is a megabyte, on a connection the reader has walked away
        // from. What comes back after that is the abort, and it says nothing.
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

  return loaded
}
