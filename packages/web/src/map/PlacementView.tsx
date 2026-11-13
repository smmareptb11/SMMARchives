import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { useEffect, useState } from 'react'

import type { FeatureCollection } from 'geojson'

import { rectangleRing, type Listening, type Placement } from '../events/placing.ts'
import { BRAND, MUTED, REPORT } from '../palette.ts'

const SOURCE = 'placement'
const EXTENT = 'placement-extent'
/** The area following the pointer from its first corner, drawn by the map alone. */
const PREVIEW = 'placement-preview'

const NOTHING: FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * How long the map stays still once a place is set: about the span of a double
 * click, whose second half would otherwise zoom, or open the station under it.
 */
const DOUBLE_CLICK_MS = 400

/**
 * Whether the map is held for placing: while the agent places, and for the
 * span of a double click after, so the gesture that set the place ends on a
 * map that still answers it as placing.
 */
export function usePlacing(listening: boolean): boolean {
  const [was, setWas] = useState(listening)
  const [settling, setSettling] = useState(false)

  // Adjusted while rendering, so the very render that ends the listening holds
  // the map: set from an effect, a second click landing between the two would
  // find the map free.
  if (was !== listening) {
    setWas(listening)
    setSettling(!listening)
  }

  useEffect(() => {
    if (!settling) return
    const timer = setTimeout(() => {
      setSettling(false)
    }, DOUBLE_CLICK_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [settling])

  return listening || settling
}

/**
 * What the report form shows on the replay's map, and what it listens for: the
 * place chosen while the form is open and, while the agent places it, each click
 * taken as a spot, the extent it must fall in, the area drawn to the pointer, and
 * a band saying what to click.
 */
export function PlacementView({
  map,
  placement,
  placing,
}: {
  map: MapLibreMap | undefined
  placement: Placement | undefined
  /** What `usePlacing` says, which outlasts the listening by a double click. */
  placing: boolean
}) {
  const listening = placement?.listening

  // The layers first, then what they draw.
  useEffect(() => {
    if (map !== undefined && map.getSource(SOURCE) === undefined) drawOn(map)
  }, [map])
  useEffect(() => {
    void map?.getSource<GeoJSONSource>(SOURCE)?.setData(placement?.drawing ?? NOTHING)
  }, [map, placement?.drawing])
  useStillOnDoubleClick(map, placing)

  useListening(map, listening)

  if (listening === undefined) return null
  return <Band listening={listening} />
}

/**
 * No zoom on a double click while placing holds: the map's own double click is
 * cancelled on the event itself, which holds whenever the second click lands.
 */
function useStillOnDoubleClick(map: MapLibreMap | undefined, placing: boolean): void {
  useEffect(() => {
    if (map === undefined || !placing) return
    const onDoubleClick = (event: MapMouseEvent) => {
      event.preventDefault()
    }
    map.on('dblclick', onDoubleClick)
    return () => {
      map.off('dblclick', onDoubleClick)
    }
  }, [map, placing])
}

/** Each click a spot while the agent places, and the map put back once done. */
function useListening(map: MapLibreMap | undefined, listening: Listening | undefined): void {
  useEffect(() => {
    if (map === undefined || listening === undefined) return
    const canvas = map.getCanvas()
    const onClick = (event: MapMouseEvent) => {
      listening.onSpot([event.lngLat.lng, event.lngLat.lat])
    }

    // Straight into the map's source, and not through React: the pointer moves
    // sixty times a second, and the form has nothing to do with where it is.
    const preview = map.getSource<GeoJSONSource>(PREVIEW)
    const { anchor } = listening
    const onMove = (event: MapMouseEvent) => {
      if (anchor === undefined) return
      const ring = rectangleRing(anchor, [event.lngLat.lng, event.lngLat.lat])
      void preview?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: ring },
      })
    }

    map.on('click', onClick)
    map.on('mousemove', onMove)
    map.setLayoutProperty(EXTENT, 'visibility', 'visible')
    canvas.style.cursor = 'crosshair'

    return () => {
      map.off('click', onClick)
      map.off('mousemove', onMove)
      void preview?.setData(NOTHING)
      map.setLayoutProperty(EXTENT, 'visibility', 'none')
      canvas.style.cursor = ''
    }
  }, [map, listening])
}

/** What the agent is placing, and the way out of it, at the top of the map. */
function Band({ listening }: { listening: Listening }) {
  return (
    <div className="placing" role="status">
      <span>{helpOf(listening)}</span>
      <button type="button" className="quiet" onClick={listening.onCancel}>
        Annuler
      </button>
    </div>
  )
}

function helpOf({ mode, anchor }: Listening): string {
  if (mode === 'point') return 'Cliquez sur la carte pour placer l’événement.'
  return anchor === undefined
    ? 'Cliquez un premier coin de la zone.'
    : 'Cliquez le coin opposé de la zone.'
}

/** The extent dashed, the place chosen in the colour of a report, the first corner of an area. */
function drawOn(map: MapLibreMap): void {
  map.addSource(SOURCE, { type: 'geojson', data: NOTHING })
  const part = (name: string) => ['==', ['get', 'part'], name] as ['==', ['get', string], string]

  map.addLayer({
    id: EXTENT,
    type: 'line',
    source: SOURCE,
    filter: part('extent'),
    layout: { visibility: 'none' },
    paint: { 'line-color': BRAND, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  })
  map.addLayer({
    id: 'placement-area',
    type: 'fill',
    source: SOURCE,
    filter: ['all', part('placed'), ['==', ['geometry-type'], 'Polygon']],
    paint: { 'fill-color': REPORT, 'fill-opacity': 0.3, 'fill-outline-color': REPORT },
  })
  map.addSource(PREVIEW, { type: 'geojson', data: NOTHING })
  map.addLayer({
    id: 'placement-preview',
    type: 'line',
    source: PREVIEW,
    paint: { 'line-color': REPORT, 'line-width': 2, 'line-dasharray': [2, 1] },
  })
  map.addLayer({
    id: 'placement-points',
    type: 'circle',
    source: SOURCE,
    filter: ['any', part('vertex'), ['all', part('placed'), ['==', ['geometry-type'], 'Point']]],
    paint: {
      'circle-radius': ['case', part('vertex'), 4, 7],
      'circle-color': ['case', part('vertex'), MUTED, REPORT],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
}
