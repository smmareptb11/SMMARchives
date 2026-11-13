import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'

import { UNION_OUTLINES } from '@smmarchives/shared/reference/perimeters.ts'

import { BRAND } from '../palette.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import type { Shown } from './families.ts'
import { KINDS, sourcesOf, type Kind } from './sources.ts'
import { reportColourOf, reportFilterOf, reportsOnTheMap, type ReportPainting } from './reports.ts'
import { NEUTRAL, paintingOf } from './state.ts'
import { haloImageOf, imageOf, ringImageOf, shadowImageOf } from './symbols.ts'

/**
 * The shape of a family, the white ring behind it, and the shadow under both.
 * The ring is a layer of its own because the shapes are plain masks, not SDFs:
 * `icon-halo-width` has no distance to grow into.
 */
export const shapeLayerOf = (kind: Kind): string => `sources-${kind}`
const ringLayerOf = (kind: Kind): string => `${shapeLayerOf(kind)}-ring`
const shadowLayerOf = (kind: Kind): string => `${shapeLayerOf(kind)}-shadow`

/**
 * The outline of the source whose detail is open, under its ring, in the
 * source's own colour: one colour of its own would read as one more threshold.
 */
const selectedLayerOf = (kind: Kind): string => `${shapeLayerOf(kind)}-selected`

/** The shape of the source the pointer rests on, which `pointing.ts` draws and the tick repaints. */
export const pointedShapeOf = (kind: Kind): string => `${shapeLayerOf(kind)}-pointed`

/**
 * The families from the one drawn underneath to the one on top: the rain
 * gauges, wider and more numerous, would hide the stations drawn over them.
 */
export const DRAWN: readonly Kind[] = ['rain-gauge', 'structure', 'watercourse']

/** A filter nothing passes: no source is open. */
export const NO_SOURCE: ExpressionSpecification = ['==', ['get', 'kind'], '']

/** Every layer that draws a family, which is what showing or thinning it reaches. */
const layersOf = (kind: Kind): string[] => [
  shapeLayerOf(kind),
  ringLayerOf(kind),
  shadowLayerOf(kind),
]

const TERRITORY_LAYER = 'syndicats'
const lineLayerOf = (layer: string): string => `${layer}-line`

/**
 * The perimeters of the basin unions, light so as not to compete with the
 * sources drawn over them.
 */
export function drawTerritory(map: MapLibreMap): void {
  // The shared contract keeps a feature's geometry opaque; the frozen outlines
  // are GeoJSON in WGS84.
  map.addSource('territory', { type: 'geojson', data: UNION_OUTLINES as FeatureCollection })
  map.addLayer({
    id: TERRITORY_LAYER,
    type: 'fill',
    source: 'territory',
    paint: { 'fill-color': BRAND, 'fill-opacity': 0.06 },
  })
  map.addLayer({
    id: lineLayerOf(TERRITORY_LAYER),
    type: 'line',
    source: 'territory',
    paint: { 'line-color': BRAND, 'line-opacity': 0.35, 'line-width': 1 },
  })
}

/**
 * The parc, as one source and layers per family, so that cutting a family off
 * is a visibility rather than a filter rebuilt from the other families. Overlap
 * is allowed: MapLibre would otherwise drop colliding sources without saying so.
 */
export function drawSources(map: MapLibreMap, content: ReplayContent): void {
  map.addSource('sources', { type: 'geojson', data: sourcesOf(content).geojson })

  // Each kind of layer across every family before the next, not family by
  // family: a shadow or a ring is wider than its shape and would rub out a
  // neighbour of another family.
  for (const kind of DRAWN) {
    addFamily(map, { kind, id: shadowLayerOf(kind), image: shadowImageOf(kind) })
  }
  for (const kind of DRAWN) {
    addFamily(map, {
      kind,
      id: selectedLayerOf(kind),
      image: haloImageOf(kind),
      colour: NEUTRAL,
      filter: NO_SOURCE,
    })
  }
  for (const kind of DRAWN) {
    addFamily(map, { kind, id: ringLayerOf(kind), image: ringImageOf(kind), colour: '#ffffff' })
  }
  for (const kind of DRAWN) {
    addFamily(map, { kind, id: shapeLayerOf(kind), image: imageOf(kind), colour: NEUTRAL })
  }
}

/** A layer of the parc; a shadow is an image of its own and takes no colour. */
type Drawn = {
  kind: Kind
  id: string
  image: string
  colour?: string
  filter?: ExpressionSpecification
}

function addFamily(map: MapLibreMap, { kind, id, image, colour, filter }: Drawn): void {
  map.addLayer({
    id,
    type: 'symbol',
    source: 'sources',
    // Mutes hidden from the first frame: `showMutes` sets this once the map is
    // ready, and starting shown would flash them.
    filter: filter ?? filterOf(kind, false),
    layout: {
      'icon-image': image,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: colour === undefined ? {} : { 'icon-color': colour },
  })
}

/**
 * Outlines the sources whose details are open, only while the source itself is
 * drawn. A station and a rain gauge can share an identifier, so the family is
 * part of what names one.
 */
export function selectSource(
  map: MapLibreMap,
  selected: readonly { kind: Kind; id: number }[],
  shown: Shown,
  mutesShown: boolean,
): void {
  for (const kind of KINDS) {
    const layer = selectedLayerOf(kind)
    if (map.getLayer(layer) === undefined) continue
    const ids = selected.filter((one) => one.kind === kind).map((one) => one.id)
    map.setFilter(
      layer,
      ids.length === 0 || !shown[kind]
        ? NO_SOURCE
        : ['all', filterOf(kind, mutesShown), ['in', ['get', 'id'], ['literal', ids]]],
    )
  }
}

/**
 * Which sources of a family a layer draws: all of them, or only those that
 * spoke, read off the `mute` property `map/sources.ts` sets.
 */
export function filterOf(kind: Kind, mutesShown: boolean): ExpressionSpecification {
  const family: ExpressionSpecification = ['==', ['get', 'kind'], kind]
  return mutesShown ? family : ['all', family, ['!=', ['get', 'mute'], true]]
}

const REPORT_AREA = 'reports-area'
const REPORT_OUTLINE = 'reports-area-line'
const REPORT_SHADOW = 'reports-shadow'
const REPORT_RING = 'reports-ring'
const REPORT_POINT = 'reports-point'
/** The diamond of the report the pointer rests on, which `pointing.ts` draws. */
export const REPORT_POINTED = 'reports-pointed'

/** Where a click lands on a report placed on a spot, and on one covering an area. */
export const REPORT_SPOTS = [REPORT_POINT]
export const REPORT_AREAS = [REPORT_AREA]

/** Nothing reported yet: the first repaint says what the cursor has reached. */
const NOTHING_YET: ReportPainting = { during: [], after: [] }

/**
 * What agents reported, above the sources: a diamond on a spot, a light area
 * otherwise. A report placed on a station is what the agent came to say about it.
 */
export function drawReports(map: MapLibreMap, content: ReplayContent): void {
  map.addSource('reports', { type: 'geojson', data: reportsOnTheMap(content.events) })

  map.addLayer({
    id: REPORT_AREA,
    type: 'fill',
    source: 'reports',
    filter: reportFilterOf(NOTHING_YET, 'Polygon'),
    paint: { 'fill-color': reportColourOf(NOTHING_YET), 'fill-opacity': 0.25 },
  })
  map.addLayer({
    id: REPORT_OUTLINE,
    type: 'line',
    source: 'reports',
    filter: reportFilterOf(NOTHING_YET, 'Polygon'),
    paint: { 'line-color': reportColourOf(NOTHING_YET), 'line-width': 2 },
  })
  for (const [id, image, colour] of [
    [REPORT_SHADOW, shadowImageOf('report'), undefined],
    [REPORT_RING, ringImageOf('report'), '#ffffff'],
    [REPORT_POINT, imageOf('report'), reportColourOf(NOTHING_YET)],
  ] as const) {
    map.addLayer({
      id,
      type: 'symbol',
      source: 'reports',
      filter: reportFilterOf(NOTHING_YET, 'Point'),
      layout: {
        'icon-image': image,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: colour === undefined ? {} : { 'icon-color': colour },
    })
  }
}

/** What agents reported, again: the screen holds one more since the map was drawn. */
export function redrawReports(map: MapLibreMap, content: ReplayContent): void {
  void map.getSource<GeoJSONSource>('reports')?.setData(reportsOnTheMap(content.events))
}

/**
 * Shows what has been reported by the instant read, in the colour of whether
 * it is still under way.
 */
export function paintReports(map: MapLibreMap, painting: ReportPainting): void {
  const colour = reportColourOf(painting)
  for (const [layer, shape] of [
    [REPORT_AREA, 'Polygon'],
    [REPORT_OUTLINE, 'Polygon'],
    [REPORT_SHADOW, 'Point'],
    [REPORT_RING, 'Point'],
    [REPORT_POINT, 'Point'],
  ] as const) {
    if (map.getLayer(layer) === undefined) continue
    map.setFilter(layer, reportFilterOf(painting, shape))
  }
  if (map.getLayer(REPORT_POINT) === undefined) return
  map.setPaintProperty(REPORT_AREA, 'fill-color', colour)
  map.setPaintProperty(REPORT_OUTLINE, 'line-color', colour)
  map.setPaintProperty(REPORT_POINT, 'icon-color', colour)
  if (map.getLayer(REPORT_POINTED) !== undefined) {
    map.setPaintProperty(REPORT_POINTED, 'icon-color', colour)
  }
}

/**
 * Draws the families the reader kept, and stops drawing the others. The cameras
 * are markers, not layers: `WebcamMarkers` answers for them, from the same state.
 */
export function showFamilies(map: MapLibreMap, shown: Shown): void {
  for (const kind of KINDS) {
    // A shape and what backs it: a ring or a shadow left alone would leave a
    // blot where the source it backed used to be.
    show(map, layersOf(kind), shown[kind])
  }
  show(map, [TERRITORY_LAYER, lineLayerOf(TERRITORY_LAYER)], shown.territory)
  show(map, [REPORT_AREA, REPORT_OUTLINE, REPORT_SHADOW, REPORT_RING, REPORT_POINT], shown.report)
}

/** Draws the sources the replay holds nothing of, in every family, or stops drawing them. */
export function showMutes(map: MapLibreMap, mutesShown: boolean): void {
  for (const kind of KINDS) {
    for (const layer of layersOf(kind)) {
      if (map.getLayer(layer) === undefined) continue
      map.setFilter(layer, filterOf(kind, mutesShown))
    }
  }
}

function show(map: MapLibreMap, layers: string[], shown: boolean): void {
  for (const layer of layers) {
    if (map.getLayer(layer) === undefined) continue
    map.setLayoutProperty(layer, 'visibility', shown ? 'visible' : 'none')
  }
}

/**
 * Repaints the whole parc at a tick: one expression per family, for its shapes,
 * the one pointed at and the outline of the one selected. The cursor changes
 * what the sources are painted with, never the data.
 */
export function paintSources(map: Painted, colours: Map<string, string>): void {
  for (const kind of KINDS) {
    const painting = expressionFor(paintingOf(kind, colours))
    for (const layer of [shapeLayerOf(kind), selectedLayerOf(kind), pointedShapeOf(kind)]) {
      if (map.getLayer(layer) === undefined) continue
      map.setPaintProperty(layer, 'icon-color', painting)
    }
  }
}

/** What repainting asks of a map, and nothing more. */
type Painted = {
  getLayer: (id: string) => unknown
  setPaintProperty: (
    layer: string,
    property: 'icon-color',
    value: string | ExpressionSpecification,
  ) => unknown
}

/**
 * A painting as MapLibre reads it. The first branch is written out: `match`
 * refuses a call with no branch, which is the ordinary parc with nothing in
 * alert, and a spread cannot promise the compiler a pair.
 */
function expressionFor(painting: ReturnType<typeof paintingOf>): string | ExpressionSpecification {
  const [first, ...others] = painting.branches
  if (first === undefined) return painting.fallback

  return [
    'match',
    ['get', 'key'],
    first.keys,
    first.colour,
    ...others.flatMap((one) => [one.keys, one.colour]),
    painting.fallback,
  ]
}
