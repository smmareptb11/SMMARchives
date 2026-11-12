import 'maplibre-gl/dist/maplibre-gl.css'

import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { BLANK, groundOf } from './ground.ts'
import {
  drawReports,
  drawSources,
  drawTerritory,
  paintReports,
  paintSources,
  redrawReports,
  showFamilies,
  showMutes,
} from './layers.ts'
import { drawPointed, usePointed } from './pointing.ts'
import { reportPaintingAt, samePainting, type ReportPainting } from './reports.ts'
import { offsetFor, roomFor, type Asked } from './frame.ts'
import { openingOn, overviewControl } from './overview.ts'
import { useExported } from './exportControl.ts'
import { addShapes } from './symbols.ts'
import { EVERYTHING, type Shown } from './families.ts'
import { MapLegend } from './Legend.tsx'
import { SourceDetail } from './SourceDetail.tsx'
import { PlacementView, usePlacing } from './PlacementView.tsx'
import type { Views } from '../pictures.ts'
import type { Detail } from './useWindows.ts'
import type { Window } from './windows.ts'
import type { Placement } from '../events/placing.ts'

/** The Aude basin, so a replay holding nothing placed still opens somewhere. */
const FALLBACK = { center: [2.55, 43.17] as [number, number], zoom: 8.6 }

/**
 * Builds the map once, tears it down once, and says whether it has ground.
 *
 * Its own hook because it runs a single time whatever else changes, where the
 * component around it re-renders on every tick of the cursor.
 */
function useMountedMap(
  held: RefObject<ReplayContent>,
  drawn: RefObject<MapLibreMap | undefined>,
  onReady: (ready: boolean) => void,
): { container: RefObject<HTMLDivElement | null>; groundless: boolean } {
  const container = useRef<HTMLDivElement>(null)
  const [groundless, setGroundless] = useState(false)

  useEffect(() => {
    let map: MapLibreMap | undefined
    let left = false

    void groundOf().then((style) => {
      if (left || container.current === null) return
      setGroundless(style === BLANK)

      map = new MapLibreMap({
        container: container.current,
        style,
        attributionControl: { compact: true },
        ...FALLBACK,
      })
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')

      // On the style being set, not on the first render: what a source needs is
      // somewhere to be added to, and tiles that never arrive would otherwise
      // take the whole parc down with them.
      const created = map
      map.once('styledata', () => {
        drawEverything(created, held)
        drawn.current = created
        onReady(true)
      })
    })

    return () => {
      left = true
      drawn.current = undefined
      onReady(false)
      map?.remove()
    }
  }, [held, drawn, onReady])

  return { container, groundless }
}

/** Everything a replay puts on the map, once there is a style to put it on. */
function drawEverything(map: MapLibreMap, held: RefObject<ReplayContent>): void {
  const content = held.current
  addShapes(map)
  drawTerritory(map)
  drawSources(map, content)
  drawReports(map, content)
  drawPointed(map)

  const opening = openingOn(map, content)
  if (opening !== undefined)
    map.fitBounds(opening.bounds, { padding: opening.padding, animate: false })
  // Above the zoom, which MapLibre stacks under the controls added after it.
  map.addControl(
    overviewControl(() => openingOn(map, held.current)),
    'bottom-right',
  )
}

/**
 * Repaints the parc when what it shows changes, and never before it exists.
 *
 * The colours are rebuilt on every tick, so the object is always new, where
 * what it holds changes twice per crossing and once per class a rain gauge
 * climbs into. And `setPaintProperty` asks MapLibre for a full update whether
 * or not the value differs, so calling it on every tick would repaint the whole
 * parc sixty times a second to draw the same thing.
 *
 * What was kept is the painting itself and not a signature of it. Two hundred
 * and thirty-six entries spelled out, sorted and joined cost 30 µs a frame
 * against 7 µs to compare two maps — and the sort could never change the
 * answer, both producers walking lists the replay holds still.
 */
function usePaintedSources(
  ready: boolean,
  drawn: RefObject<MapLibreMap | undefined>,
  colours: Map<string, string>,
): void {
  const painted = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (!ready || drawn.current === undefined || says(painted.current, colours)) return

    painted.current = colours
    paintSources(drawn.current, colours)
  }, [ready, drawn, colours])
}

/**
 * Shows what agents had reported by the instant read, and only when that
 * changes: once per report a reading reaches, and once more when it is over.
 */
function usePaintedReports(
  ready: boolean,
  drawn: RefObject<MapLibreMap | undefined>,
  content: ReplayContent,
  { at, hidden }: { at: Cursor; hidden: string | undefined },
): void {
  const painted = useRef<ReportPainting | undefined>(undefined)
  const painting = useMemo(
    () => reportPaintingAt(content.events, at, hidden),
    [content.events, at, hidden],
  )

  // A report saved while the replay is open: the map was drawn without it.
  useEffect(() => {
    if (ready && drawn.current !== undefined) redrawReports(drawn.current, content)
  }, [ready, drawn, content])

  useEffect(() => {
    if (!ready || drawn.current === undefined) return
    if (painted.current !== undefined && samePainting(painted.current, painting)) return

    painted.current = painting
    paintReports(drawn.current, painting)
  }, [ready, drawn, painting])
}

/**
 * What the reader kept, applied to the map that draws it.
 *
 * Two effects rather than one, so neither switch redoes the other's work over
 * three hundred sources; `map/layers.ts` says what each of them answers. The
 * cameras are markers and not layers, so neither reaches them: `WebcamMarkers`
 * reads the same two states as props.
 */
function useShownSources(map: MapLibreMap | undefined, shown: Shown, mutesShown: boolean): void {
  useEffect(() => {
    if (map !== undefined) showFamilies(map, shown)
  }, [map, shown])

  useEffect(() => {
    if (map !== undefined) showMutes(map, mutesShown)
  }, [map, mutesShown])
}

/**
 * The zoom a spot is shown at when the map stands further out: a town and the
 * roads around it. Closer, the map keeps its zoom and only moves.
 */
const SPOT_ZOOM = 12

/**
 * Takes the map to where a card of the history sends it, each time one does.
 *
 * Clear of the legend, and of what the card opens: a crossing its station's
 * detail, a report its sheet.
 */
function useFlown(map: MapLibreMap | undefined, asked: Asked | undefined): void {
  useEffect(() => {
    const frame = asked?.frame
    if (map === undefined || frame === undefined) return
    const { clientWidth, clientHeight } = map.getContainer()
    const padding = roomFor(
      clientWidth,
      clientHeight,
      asked?.opens === undefined ? 'sheet' : 'detail',
    )

    if (frame.kind === 'area') map.fitBounds(frame.bounds, { padding })
    else {
      map.flyTo({
        center: frame.at,
        zoom: Math.max(map.getZoom(), SPOT_ZOOM),
        offset: offsetFor(padding),
      })
    }
  }, [map, asked])
}

/** Whether two paintings say the same thing of the same sources. */
function says(held: Map<string, string>, next: Map<string, string>): boolean {
  if (held.size !== next.size) return false

  for (const [key, colour] of next) {
    if (held.get(key) !== colour) return false
  }
  return true
}

export type MapViewProps = {
  content: ReplayContent
  colours: Map<string, string>
  replayId: string
  /** The replay's title, which the image of the map is saved under. */
  label: string | null
  at: Cursor
  /** Whether the sources the replay holds nothing of are drawn. */
  mutesShown: boolean
  onMutesShown: (shown: boolean) => void
  /** How many sources the switch holds back, the lanes' own included. */
  heldBack: number
  /** Opens what an agent reported, from the diamond or the area that stands for it. */
  onOpenReport: (id: string) => void
  /** What each camera showed, which its marker shows at the instant read. */
  views: Views
  /** The windows open over the map, which the map opens and outlines the sources of. */
  detail: Detail
  windows: readonly Window[]
  /** What the report form asks the map to draw and listen for, while it is open. */
  placement: Placement | undefined
  /** Where a card of the history sends the map, and the station it opens there. */
  asked: Asked | undefined
}

export function MapView({
  content,
  colours,
  replayId,
  label,
  at,
  mutesShown,
  onMutesShown,
  heldBack,
  onOpenReport,
  placement,
  asked,
  views,
  detail,
  windows,
}: MapViewProps) {
  const drawn = useRef<MapLibreMap | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [shown, setShown] = useState<Shown>(EVERYTHING)

  // The handle, once there is one to hang anything on. Read from the ref rather
  // than held in state: what says it is there is `ready`, set beside it.
  const hung = ready ? drawn.current : undefined
  useShownSources(hung, shown, mutesShown)
  usePaintedSources(ready, drawn, colours)
  useFlown(hung, asked)
  usePointed(hung, shown, mutesShown)
  usePaintedReports(ready, drawn, content, { at, hidden: placement?.amending })
  useExported(hung, label, at)
  const placing = usePlacing(placement?.listening !== undefined)

  return (
    <>
      <Ground content={content} drawn={drawn} onReady={setReady} />
      <MapLegend {...{ content, shown, mutesShown, onMutesShown, heldBack }} onChange={setShown} />
      {/* Hung on the map rather than drawn by it, and so only once it exists. */}
      <SourceDetail
        {...{ content, replayId, at, shown, mutesShown, onOpenReport, placing, asked }}
        {...{ views, detail, windows }}
        map={hung}
        onSpot={placement?.listening?.onSpot}
      />
      <PlacementView map={hung} placement={placement} placing={placing} />
    </>
  )
}

/**
 * The map itself, mounted once and torn down once.
 *
 * Apart from what repaints it, because a component that both builds a map and
 * follows a cursor reads as two things at once — and only one of them runs more
 * than a single time.
 */
function Ground({
  content,
  drawn,
  onReady,
}: {
  content: ReplayContent
  drawn: RefObject<MapLibreMap | undefined>
  onReady: (ready: boolean) => void
}) {
  // The content is read through a ref rather than taken as a dependency: a map
  // rebuilt whenever the object changes would flash, and lose wherever the
  // reader had panned to.
  const held = useRef<ReplayContent>(content)
  held.current = content
  const { container, groundless } = useMountedMap(held, drawn, onReady)

  return (
    <>
      {groundless ? (
        <p className="note refusal">
          Fond de carte injoignable. Les sources sont à leur place, le fond reste blanc.
        </p>
      ) : null}
      <div className="map" ref={container} />
    </>
  )
}
