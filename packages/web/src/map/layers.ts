import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification, ImageSource, Map as MapLibreMap } from 'maplibre-gl'

import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'

import { BRAND } from '../palette.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { territoryOf, type Shown } from './families.ts'
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
export function drawTerritory(map: MapLibreMap, content: ReplayContent): void {
  const layer = territoryOf(content)
  if (layer === undefined) return

  // The shared contract keeps a feature's geometry opaque: a collector only
  // checks and walks it, and typing it whole would make every source declare a
  // geometry it never reads. What the Lizmap serves is GeoJSON in WGS84, and
  // the recorded responses under `tests/fixtures/` are what attest it.
  map.addSource('territory', { type: 'geojson', data: layer.geojson as FeatureCollection })
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

const RADAR_LAYER = 'radar'

/**
 * A transparent pixel, because an image source needs an address to be created.
 *
 * The layer is added before the reading has picked an image, and holding the
 * first one back until then would put the layer over the parc rather than under
 * it — order of insertion is the map's only order.
 */
const NO_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * The four corners MapLibre lays an image on, clockwise from the north-west.
 *
 * Longitude first, as GeoJSON orders a position and as the parc is written:
 * swapped, the mosaic lands in the Indian Ocean. Nothing here reprojects — the
 * corners are laid out linearly in Mercator, which is what `L.imageOverlay`
 * does in the SMMAR's own crisis Lizmap, so the map reproduces that placing
 * rather than inventing one of its own.
 */
export function cornersOf(extent: BoundingBox): [Corner, Corner, Corner, Corner] {
  return [
    [extent.minLon, extent.maxLat],
    [extent.maxLon, extent.maxLat],
    [extent.maxLon, extent.minLat],
    [extent.minLon, extent.minLat],
  ]
}

type Corner = [number, number]

/**
 * The rainfall layer, under the ground and the parc, and drawn on asking.
 *
 * Added before them because insertion is the only order this map has, and an
 * image over three hundred markers hides what a reader came for. Nothing at all
 * when the replay holds no image or no extent to place one on: `map/families.ts`
 * answers the same question for the switch, and the two agree by asking it of
 * the same two halves.
 */
export function drawRadar(map: MapLibreMap, content: ReplayContent): void {
  const extent = content.radarExtent
  if (extent === undefined || !content.series.some((one) => one.frames.length > 0)) return

  map.addSource(RADAR_LAYER, { type: 'image', url: NO_IMAGE, coordinates: cornersOf(extent) })
  map.addLayer(
    {
      id: RADAR_LAYER,
      type: 'raster',
      source: RADAR_LAYER,
      layout: { visibility: 'none' },
      paint: {
        // Nothing here: the documentation records that every entry of the palette carries
        // `alpha = 128`, the half-transparency being baked into the image. A
        // second one would leave a pale ramp at a third of its opacity, on the
        // very layer a reader is asked to judge the placing of.
        'raster-opacity': 1,
        // The basin is 0.6 % of a France-wide mosaic, so a reader at basin zoom is
        // looking at about a hundred pixels blown up.
        'raster-resampling': 'linear',
        // A fade between two images leaves a trail behind a reading that moves.
        'raster-fade-duration': 0,
      },
    },
    firstLabelOf(map),
  )
}

/**
 * The basemap layer the rainfall goes under, which is its first label.
 *
 * Appending would put a France-wide mosaic over the coastline, the rivers and
 * the place names — the very references a reader needs to judge whether the
 * image is placed right, which is the whole point of drawing it. What the replay
 * draws stays above, being added later still.
 */
function firstLabelOf(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((one) => one.type === 'symbol')?.id
}

/**
 * The image the reading stands on, or none at all.
 *
 * A frame the index holds and the replay never froze — a build run without media,
 * or the one copy `replay/media.ts` survives the failure of — is not answered
 * for here: MapLibre keeps the texture it last had, and the reader sees the
 * neighbouring image for that one instant. Blanking it needs the source's own
 * failure, which MapLibre's typed `ErrorEvent` does not carry.
 *
 *
 * One call for both, because they are one answer: an address is what there is
 * to draw, and its absence is a hole in the delivery rather than a layer the
 * reader cut off. Whoever calls this holds what it last drew — reassigning the
 * same address makes the browser release the image and fetch it again, sixty
 * times a second.
 */
export function showRadar(map: RadarCanvas, url: string | undefined): void {
  if (map.getLayer(RADAR_LAYER) === undefined) return

  if (url !== undefined) (map.getSource(RADAR_LAYER) as ImageSource).updateImage({ url })
  show(map, [RADAR_LAYER], url !== undefined)
}

/**
 * The three questions `showRadar` asks of a map, and nothing besides.
 *
 * Narrower than `Map` on purpose. A test can build one of these and have it
 * type-check, where standing in for the whole of MapLibre takes the double
 * assertion the lint refuses — and for the reason it gives: a fake built that
 * way drifts from the real port without a single error.
 */
export type RadarCanvas = {
  getLayer(id: string): unknown
  getSource(id: string): unknown
  setLayoutProperty(layer: string, name: string, value: unknown): void
}

/** What a map already carries: the image on it, and which map it was put on. */
export type Placed = { map: RadarCanvas; url: string | undefined }

/**
 * Whether the image the reading now asks for is not the one already on the map.
 *
 * The address alone would not do. A map torn down takes its layers with it and
 * the next one opens without the image, so a reader who reloaded on the same
 * instant would face a blank until they moved the cursor. Judged on the map's
 * own identity for that reason, and never on its contents.
 */
export function redraws(held: Placed | undefined, next: Placed): boolean {
  return held?.map !== next.map || held.url !== next.url
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
 *
 * Written against `true` rather than negated: a feature of a replay built
 * before this property existed carries no `mute` at all, and it is drawn.
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
 * Every family whose drawing is a visibility and nothing else answers here. The
 * cameras are markers, and the rainfall is a layer whose drawing also depends on
 * the reading having an image to put on it, so `WebcamMarkers` and `RadarLayer`
 * answer for those two — from the same state.
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

function show(map: RadarCanvas, layers: string[], shown: boolean): void {
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
