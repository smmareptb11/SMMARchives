import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { useContext, useEffect } from 'react'

import { MUTED, POINTED } from '../palette.ts'
import type { Shown } from './families.ts'
import {
  DRAWN,
  filterOf,
  NO_SOURCE,
  pointedShapeOf,
  REPORT_POINTED,
  shapeLayerOf,
} from './layers.ts'
import { PointerContext, type Pointed } from './pointed.ts'
import { KINDS, type Kind } from './sources.ts'
import { NEUTRAL } from './state.ts'
import { haloImageOf, imageOf, ringImageOf } from './symbols.ts'

/**
 * The source the pointer rests on in the lanes or the history, drawn again over
 * the whole map and larger, in a dark outline: found at a glance in a valley of
 * three hundred, and never mistaken for the outline of an open detail, which is
 * in the source's own colour.
 */
const layersOf = (kind: Kind) => ({
  halo: `${shapeLayerOf(kind)}-pointed-halo`,
  ring: `${shapeLayerOf(kind)}-pointed-ring`,
  shape: pointedShapeOf(kind),
})

const REPORT_LINE = 'reports-pointed-line'
const REPORT_HALO = 'reports-pointed-halo'
const REPORT_RING = 'reports-pointed-ring'

/** How much larger a source or a report is drawn while the pointer rests on it. */
const SIZE = 1.5

/** A filter no report passes: the pointer rests on none. */
const NO_REPORT: ExpressionSpecification = ['==', ['get', 'report'], '']

/**
 * The layers that light up what the pointer rests on, over everything else the
 * map draws. Each passes nothing until the pointer rests somewhere.
 */
export function drawPointed(map: MapLibreMap): void {
  for (const kind of DRAWN) {
    const layers = layersOf(kind)
    addLit(map, 'sources', NO_SOURCE, [
      [layers.halo, haloImageOf(kind), POINTED],
      [layers.ring, ringImageOf(kind), '#ffffff'],
      [layers.shape, imageOf(kind), NEUTRAL],
    ])
  }

  map.addLayer({
    id: REPORT_LINE,
    type: 'line',
    source: 'reports',
    filter: NO_REPORT,
    paint: { 'line-color': POINTED, 'line-width': 4 },
  })
  // Grey until the reading reaches it: `paintReports` gives it the colour of
  // the report's phase, as it does every other diamond.
  addLit(map, 'reports', NO_REPORT, [
    [REPORT_HALO, haloImageOf('report'), POINTED],
    [REPORT_RING, ringImageOf('report'), '#ffffff'],
    [REPORT_POINTED, imageOf('report'), MUTED],
  ])
}

function addLit(
  map: MapLibreMap,
  source: string,
  filter: ExpressionSpecification,
  layers: readonly (readonly [string, string, string])[],
): void {
  for (const [id, image, colour] of layers) {
    map.addLayer({
      id,
      type: 'symbol',
      source,
      filter,
      layout: {
        'icon-image': image,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': SIZE,
      },
      paint: { 'icon-color': colour },
    })
  }
}

/**
 * Lights up what the pointer rests on: a source, or what an agent reported. A
 * camera is a marker, and `WebcamMarkers` lights it up from the same pointer.
 *
 * A source only while it is drawn, as an outline is: lit where its family is
 * cut off or the switch holds it back, it would be a blot where nothing is. A
 * report even before the reading reaches it, since that is when a reader asks
 * where it will be.
 */
export function pointAt(
  map: MapLibreMap,
  pointed: Pointed | undefined,
  shown: Shown,
  mutesShown: boolean,
): void {
  for (const kind of KINDS) {
    const filter = shown[kind] ? pointedFilterOf(kind, pointed, mutesShown) : NO_SOURCE
    setFilters(map, Object.values(layersOf(kind)), filter)
  }

  const report = shown.report ? pointedReportOf(pointed) : ''
  const of = (shape: 'Point' | 'Polygon'): ExpressionSpecification => [
    'all',
    ['==', ['geometry-type'], shape],
    ['==', ['get', 'report'], report],
  ]
  setFilters(map, [REPORT_LINE], of('Polygon'))
  setFilters(map, [REPORT_HALO, REPORT_RING, REPORT_POINTED], of('Point'))
}

function setFilters(map: MapLibreMap, layers: string[], filter: ExpressionSpecification): void {
  for (const layer of layers) {
    if (map.getLayer(layer) !== undefined) map.setFilter(layer, filter)
  }
}

/** Which source of a family the pointer lights up: the one it rests on, if drawn. */
export function pointedFilterOf(
  kind: Kind,
  pointed: Pointed | undefined,
  mutesShown: boolean,
): ExpressionSpecification {
  if (pointed === undefined || !('source' in pointed) || pointed.source !== kind) return NO_SOURCE
  return ['all', filterOf(kind, mutesShown), ['==', ['get', 'id'], pointed.id]]
}

/** The report the pointer rests on, or none: no report is named the empty string. */
function pointedReportOf(pointed: Pointed | undefined): string {
  return pointed !== undefined && 'report' in pointed ? pointed.report : ''
}

/**
 * Lights up on the map what the pointer rests on in the lanes or the history,
 * as it moves, without rendering anything: the pointer is not React's state.
 */
export function usePointed(map: MapLibreMap | undefined, shown: Shown, mutesShown: boolean): void {
  const pointer = useContext(PointerContext)

  useEffect(() => {
    if (map === undefined) return
    const light = (pointed: Pointed | undefined) => {
      pointAt(map, pointed, shown, mutesShown)
    }
    light(pointer.get())
    return pointer.subscribe(light)
  }, [map, pointer, shown, mutesShown])
}
