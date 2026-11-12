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
 *
 * The ring is a layer rather than the icon's halo. A halo grows into the
 * distance an SDF encodes around its edge, and the shapes are drawn as plain
 * masks, which encode none: `icon-halo-width` has nothing to bite into. The
 * same shape grown all round and drawn in white underneath gives the outline the
 * crisis tool puts around every symbol, and it is what keeps two markers
 * apart when three hundred of them crowd one valley. The shadow lifts each one
 * off the ground, as the mockup's do.
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
 * The families from the one drawn underneath to the one on top: a rain gauge's
 * triangle is wider than a station's circle, and the rain gauges outnumber the
 * stations three to one, so drawn over them they hide the stations a replay
 * is about.
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

export const TERRITORY_LAYER = 'syndicats'
const lineLayerOf = (layer: string): string => `${layer}-line`

/**
 * The perimeters of the seven basin unions, which are the replay's ground.
 *
 * Light on purpose: they say where the territory ends, and anything more
 * insistent would compete with the sources drawn over them.
 */
export function drawTerritory(map: MapLibreMap): void {
  // The shared contract keeps a feature's geometry opaque: a collector only
  // checks and walks it, and typing it whole would make every source declare a
  // geometry it never reads. The frozen outlines are GeoJSON in WGS84.
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
 * The parc, as one source and two layers per shape.
 *
 * Layers per family rather than one filtered layer, because cutting a family
 * off is then a visibility property instead of a filter rebuilt from what the
 * other families are doing.
 *
 * Overlap is allowed: two hundred and twenty-nine rain gauges over a territory
 * this size do collide, and letting MapLibre drop the ones that collide would
 * hide sources without saying so.
 */
export function drawSources(map: MapLibreMap, content: ReplayContent): void {
  map.addSource('sources', { type: 'geojson', data: sourcesOf(content).geojson })

  // Every shadow first, every ring next, every shape last, and not one family
  // after the other: a shadow or a ring is wider than the shape it backs, and
  // drawn over a neighbour of another family it would rub it out.
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
    // Hidden from the first frame: `showMutes` reposes this the moment the map
    // is ready, and starting shown would flash two hundred grey triangles.
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
 * Outlines the sources whose details are open.
 *
 * Only while the source itself is drawn: an outline around a family cut off,
 * or around a source the switch holds back, would be a blot where
 * nothing is. A station and a rain gauge can share an identifier, so the
 * family is part of what names it.
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
 * Which sources of a family a layer draws.
 *
 * A filter and not a visibility, where cutting a family off is a visibility:
 * what the reader asks here is that some of a family's sources be left out, and
 * the family beside them goes on being drawn. Read off a property the parc
 * already carries — `map/sources.ts` puts it there — so a toggle costs one
 * filter per layer rather than three hundred features rewritten.
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
 * What agents reported, over the sources: a diamond on a spot, an area
 * otherwise.
 *
 * Above the parc, because a report placed on a station is what the agent came
 * to say about it, and the station is still there once the report is cut off.
 * The area is light, so the ground and the sources under it stay legible.
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
 * it is still under way. A filter and a paint property: the reports themselves
 * do not change, only which of them the cursor has reached.
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
 * Draws the families the reader kept, and stops drawing the others.
 *
 * A visibility property rather than a filter: what the reader asked is that a
 * family not be drawn, and rebuilding a filter from what the other families are
 * doing would make each family's answer depend on the others.
 *
 * Every family the map draws itself answers here. The cameras are markers and
 * not layers, so `WebcamMarkers` answers for them — from the same state.
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

/**
 * Draws the sources the replay holds nothing of, or stops drawing them.
 *
 * Apart from `showFamilies` because the two answer different questions and a
 * reader sets them apart: a family is cut off whole, where this one thins every
 * family down to the sources that spoke.
 */
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
 * Repaints the whole parc at a tick: one expression per family, for its shapes
 * and for the outline of the one selected.
 *
 * One paint property rather than a rewrite of three hundred features: what the
 * cursor changes is not the data but what it is painted with. What to paint
 * with is `map/state.ts`'s business; this turns it into an expression.
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
 * A painting as MapLibre reads it.
 *
 * The first branch is written out rather than spread: `match` refuses a call
 * with no branch — a parc with nothing in alert is the ordinary case, not an
 * edge one — and a spread cannot promise a compiler that it holds a pair.
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
