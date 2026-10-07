import 'maplibre-gl/dist/maplibre-gl.css'

import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { BLANK, groundOf } from './ground.ts'
import { drawSources, drawTerritory, paintSources, showFamilies, showMutes } from './layers.ts'
import { boundsOf } from './sources.ts'
import { addShapes } from './symbols.ts'
import { CalloutView } from './CalloutView.tsx'
import { useCallout, useSourceClicks, type Open } from './useCallout.ts'
import { EVERYTHING, type Shown } from './families.ts'
import { viewsOf, type Views } from '../pictures.ts'
import { LayerPanel } from './LayerPanel.tsx'
import { silencesOf } from './silences.ts'
import { WebcamMarkers } from './WebcamMarkers.tsx'

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
        drawEverything(created, held.current)
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
function drawEverything(map: MapLibreMap, content: ReplayContent): void {
  addShapes(map)
  drawTerritory(map)
  drawSources(map, content)

  const bounds = boundsOf(content)
  if (bounds !== undefined) map.fitBounds(bounds, { padding: 40, animate: false })
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
  at: Cursor
  /** Whether the sources the replay holds nothing of are drawn. */
  mutesShown: boolean
  onMutesShown: (shown: boolean) => void
  /** How many sources the switch holds back, the lanes' own included. */
  heldBack: number
}

export function MapView({
  content,
  colours,
  replayId,
  at,
  mutesShown,
  onMutesShown,
  heldBack,
}: MapViewProps) {
  const drawn = useRef<MapLibreMap | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [shown, setShown] = useState<Shown>(EVERYTHING)

  // The handle, once there is one to hang anything on. Read from the ref rather
  // than held in state: what says it is there is `ready`, set beside it.
  const hung = ready ? drawn.current : undefined
  const { bubble, shown: open } = useCallout(hung, replayId)
  useSourceClicks(hung, bubble)
  const views = useMemo(() => viewsOf(content.images), [content.images])

  useShownSources(hung, shown, mutesShown)
  usePaintedSources(ready, drawn, colours)

  return (
    <>
      <Ground content={content} drawn={drawn} onReady={setReady} />
      <LayerPanel
        content={content}
        shown={shown}
        onChange={setShown}
        mutesShown={mutesShown}
        onMutesShown={onMutesShown}
        heldBack={heldBack}
      />
      <Silences content={content} />
      {/* Hung on the map rather than drawn by it, and so only once it exists. */}
      <WebcamMarkers
        map={hung}
        content={content}
        replayId={replayId}
        at={at}
        bubble={bubble}
        shown={shown.webcam}
        mutesShown={mutesShown}
        views={views}
      />
      <Callout open={open} content={content} views={views} replayId={replayId} at={at} />
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

/**
 * What the open bubble says, rendered into the element MapLibre shows.
 *
 * A portal rather than a subtree of its own: the element belongs to the popup,
 * which MapLibre moves and removes, and React only fills it.
 */
function Callout({
  open,
  content,
  views,
  replayId,
  at,
}: {
  open: Open | undefined
  content: ReplayContent
  views: Views
  replayId: string
  at: Cursor
}) {
  if (open === undefined) return null

  return createPortal(
    <CalloutView
      subject={open.subject}
      content={content}
      views={views}
      replayId={replayId}
      at={at}
    />,
    open.container,
  )
}

/** What the map holds back, as `map/silences.ts` decides to put it. */
const Silences = memo(function Silences({ content }: { content: ReplayContent }) {
  // Memoised because the map beside it re-renders on every tick, and one of
  // these sentences counts a collection of three hundred features.
  const said = useMemo(() => silencesOf(content), [content])

  return (
    <ul className="silences">
      {said.map((one) => (
        <li key={one}>{one}</li>
      ))}
    </ul>
  )
})
