import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'

import { UNION_OUTLINES } from '@smmarchives/shared/reference/perimeters.ts'

import { BRAND } from '../palette.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import type { Shown } from './families.ts'
import { KINDS, sourcesOf, type Kind } from './sources.ts'
import { NEUTRAL, paintingOf } from './state.ts'
import { imageOf, widthOf } from './symbols.ts'

/**
 * The shape of a family, and the white ring behind it.
 *
 * The ring is a layer rather than the icon's halo. A halo grows into the
 * distance an SDF encodes around its edge, and the shapes are drawn as plain
 * masks, which encode none: `icon-halo-width` has nothing to bite into. The
 * same shape drawn slightly larger in white underneath gives the outline the
 * mockup puts around every marker, and it is what keeps two markers apart when
 * three hundred of them crowd one valley.
 */
export const shapeLayerOf = (kind: Kind): string => `sources-${kind}`
const ringLayerOf = (kind: Kind): string => `${shapeLayerOf(kind)}-ring`

export const TERRITORY_LAYER = 'syndicats'
const lineLayerOf = (layer: string): string => `${layer}-line`

/**
 * How thick the white ring is, in pixels of the drawn shape.
 *
 * A width and not a scale: scaled, a ring would be thicker around the triangle
 * of a rain gauge than around the square of a structure, for no reason a reader
 * could name.
 */
const RING = 1.5

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

  // Every ring first, every shape after, and not ring-then-shape per family:
  // a rain gauge's ring is wider than a station's circle, and drawn over it it
  // would rub the station out wherever the two stand side by side.
  for (const kind of KINDS) {
    addFamily(map, { kind, id: ringLayerOf(kind), size: ringScaleOf(kind), colour: '#ffffff' })
  }
  for (const kind of KINDS) {
    addFamily(map, { kind, id: shapeLayerOf(kind), size: 1, colour: NEUTRAL })
  }
}

type Drawn = { kind: Kind; id: string; size: number; colour: string }

function addFamily(map: MapLibreMap, { kind, id, size, colour }: Drawn): void {
  map.addLayer({
    id,
    type: 'symbol',
    source: 'sources',
    // Hidden from the first frame: `showMutes` reposes this the moment the map
    // is ready, and starting shown would flash two hundred grey triangles.
    filter: filterOf(kind, false),
    layout: {
      'icon-image': imageOf(kind),
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': size,
    },
    paint: { 'icon-color': colour },
  })
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

/** The scale that adds `RING` pixels on each side of a shape of this width. */
function ringScaleOf(kind: Kind): number {
  return 1 + (2 * RING) / widthOf(kind)
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
    // A shape and the white ring that backs it: a ring left alone would leave
    // a white blot where the source it backed used to be.
    show(map, [shapeLayerOf(kind), ringLayerOf(kind)], shown[kind])
  }
  show(map, [TERRITORY_LAYER, lineLayerOf(TERRITORY_LAYER)], shown.territory)
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
    for (const layer of [shapeLayerOf(kind), ringLayerOf(kind)]) {
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
 * Repaints the whole parc at a tick, in one call per family.
 *
 * One paint property rather than a rewrite of three hundred features: what the
 * cursor changes is not the data but what it is painted with. What to paint
 * with is `map/state.ts`'s business; this turns it into an expression.
 */
export function paintSources(map: MapLibreMap, colours: Map<string, string>): void {
  for (const kind of KINDS) {
    const layer = shapeLayerOf(kind)
    if (map.getLayer(layer) === undefined) continue
    map.setPaintProperty(layer, 'icon-color', expressionFor(paintingOf(kind, colours)))
  }
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
