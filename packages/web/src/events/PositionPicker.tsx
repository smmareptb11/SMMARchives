import 'maplibre-gl/dist/maplibre-gl.css'

import type { EventPosition } from '@smmarchives/shared/contracts/event.ts'
import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import {
  Map as MapLibreMap,
  NavigationControl,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { groundOf } from '../map/ground.ts'
import { BRAND, MUTED, REPORT } from '../palette.ts'
import { areaOf, drawingOf, pointAt, type Spot } from './placing.ts'

export type PositionPickerProps = {
  extent: BoundingBox
  value: EventPosition | null
  onChange: (position: EventPosition | null) => void
  refusal: string | undefined
}

type Mode = 'point' | 'area'

/**
 * Where the event happened: a spot, or an area traced vertex by vertex.
 *
 * A map of its own, inside the form: the replay's map goes on being repainted
 * by the reading and answering clicks on its stations, and tracing an area on
 * it would fight both.
 */
export function PositionPicker({ extent, value, onChange, refusal }: PositionPickerProps) {
  const [mode, setMode] = useState<Mode>('point')
  const [tracing, setTracing] = useState<Spot[]>([])
  const [said, setSaid] = useState<string | undefined>(undefined)
  const held = useRef({ mode, extent, onChange, setTracing, setSaid })
  held.current = { mode, extent, onChange, setTracing, setSaid }
  const { container, map } = useSmallMap(held)

  useEffect(() => {
    const source = map?.getSource<GeoJSONSource>('drawing')
    void source?.setData(drawingOf(extent, value, tracing))
  }, [map, extent, value, tracing])

  const finish = () => {
    const placed = areaOf(tracing, extent)
    if ('refusal' in placed) return setSaid(placed.refusal)
    onChange(placed.position)
    setTracing([])
  }
  const clear = () => {
    onChange(null)
    setTracing([])
    setSaid(undefined)
  }

  return (
    <fieldset className="position-picker">
      <legend>Lieu (facultatif)</legend>
      <ModeChoice mode={mode} onChange={(next) => (setMode(next), setTracing([]))} />
      <p className="note">{help(mode, tracing.length)}</p>
      <div className="position-map" ref={container} />
      <div className="position-actions">
        {mode === 'area' ? (
          <button type="button" disabled={tracing.length < 3} onClick={finish}>
            Terminer la zone
          </button>
        ) : null}
        <button
          type="button"
          className="quiet"
          disabled={value === null && tracing.length === 0}
          onClick={clear}
        >
          Effacer
        </button>
      </div>
      {(said ?? refusal) === undefined ? null : <span className="refused">{said ?? refusal}</span>}
    </fieldset>
  )
}

function help(mode: Mode, vertices: number): string {
  if (mode === 'point') return 'Cliquez sur la carte pour placer l’événement.'
  return vertices === 0
    ? 'Cliquez sur la carte pour poser chaque sommet de la zone.'
    : `${String(vertices)} sommet${vertices > 1 ? 's' : ''} posé${vertices > 1 ? 's' : ''}. « Terminer la zone » la ferme.`
}

function ModeChoice({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="position-mode" role="radiogroup" aria-label="Forme du lieu">
      {(['point', 'area'] as const).map((one) => (
        <label key={one}>
          <input type="radio" checked={mode === one} onChange={() => onChange(one)} />
          {one === 'point' ? 'Un point' : 'Une zone'}
        </label>
      ))}
    </div>
  )
}

type Held = RefObject<{
  mode: Mode
  extent: BoundingBox
  onChange: (position: EventPosition | null) => void
  setTracing: (update: (held: Spot[]) => Spot[]) => void
  setSaid: (said: string | undefined) => void
}>

/**
 * The small map, built once, opened on the extent.
 *
 * Everything it reads goes through the ref — the extent it opens on, and the
 * form's state a click acts on — so it is built a single time, and the click
 * handler is not rebound on every vertex.
 */
function useSmallMap(held: Held): {
  container: RefObject<HTMLDivElement | null>
  map: MapLibreMap | undefined
} {
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap | undefined>(undefined)

  useEffect(() => {
    let built: MapLibreMap | undefined
    let left = false

    void groundOf().then((style) => {
      if (left || container.current === null) return
      built = smallMap(container.current, style, held)
      built.once('styledata', ready(built, held, setMap))
    })

    return () => {
      left = true
      built?.remove()
    }
  }, [held])

  return { container, map }
}

function smallMap(
  container: HTMLElement,
  style: string | StyleSpecification,
  held: Held,
): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style,
    doubleClickZoom: false,
    // As on the replay's map: folded at the first move, which on a map this
    // small is the first thing an agent does.
    attributionControl: { compact: true },
  })
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
  map.fitBounds(boundsOf(held.current.extent), { padding: 10, animate: false })
  return map
}

/** Once there is a style to draw on: the layers, the click, and the map handed over. */
function ready(map: MapLibreMap, held: Held, setMap: (map: MapLibreMap) => void): () => void {
  return () => {
    drawOn(map)
    map.on('click', (event) => {
      onClick(event, held)
    })
    setMap(map)
  }
}

function onClick(event: MapMouseEvent, held: Held): void {
  const { mode, extent, onChange, setTracing, setSaid } = held.current
  const spot: Spot = [event.lngLat.lng, event.lngLat.lat]
  setSaid(undefined)

  if (mode === 'area') {
    setTracing((vertices) => [...vertices, spot])
    return
  }
  const placed = pointAt(spot, extent)
  if ('refusal' in placed) setSaid(placed.refusal)
  else onChange(placed.position)
}

function boundsOf(extent: BoundingBox): [[number, number], [number, number]] {
  return [
    [extent.minLon, extent.minLat],
    [extent.maxLon, extent.maxLat],
  ]
}

/** The extent dashed, the place chosen in the colour of a report, the area being traced. */
function drawOn(map: MapLibreMap): void {
  map.addSource('drawing', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  const part = (name: string) => ['==', ['get', 'part'], name] as ['==', ['get', string], string]

  map.addLayer({
    id: 'extent',
    type: 'line',
    source: 'drawing',
    filter: part('extent'),
    paint: { 'line-color': BRAND, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  })
  map.addLayer({
    id: 'placed-area',
    type: 'fill',
    source: 'drawing',
    filter: ['all', part('placed'), ['==', ['geometry-type'], 'Polygon']],
    paint: { 'fill-color': REPORT, 'fill-opacity': 0.3, 'fill-outline-color': REPORT },
  })
  map.addLayer({
    id: 'tracing',
    type: 'line',
    source: 'drawing',
    filter: part('tracing'),
    paint: { 'line-color': REPORT, 'line-width': 2, 'line-dasharray': [2, 1] },
  })
  map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'drawing',
    filter: ['any', part('vertex'), ['all', part('placed'), ['==', ['geometry-type'], 'Point']]],
    paint: {
      'circle-radius': ['case', part('vertex'), 4, 7],
      'circle-color': ['case', part('vertex'), MUTED, REPORT],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
}
