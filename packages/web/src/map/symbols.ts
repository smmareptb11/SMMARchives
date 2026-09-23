import type { Map as MapLibreMap } from 'maplibre-gl'

import { KINDS, type Kind } from './sources.ts'

/**
 * The three shapes of the mockup, in the sizes it drew them at.
 *
 * A rain gauge is wider than it is tall because a triangle reads as a triangle
 * only when its base is wide enough to be seen.
 */
const SIZE: Record<Kind, [number, number]> = {
  watercourse: [15, 15],
  structure: [14, 14],
  'rain-gauge': [18, 16],
}

/** So a shape drawn for one map is not redrawn for the next. */
export const imageOf = (kind: Kind): string => `source-${kind}`

/** How wide a shape is drawn, which is what a ring around it is measured against. */
export const widthOf = (kind: Kind): number => SIZE[kind][0]

/**
 * Draws the three shapes once into the map's own sprite.
 *
 * Registered as signed distance fields, which is what lets a single paint
 * property tint the whole parc at a tick: a plain icon cannot be recoloured,
 * and recolouring is what the cursor is for. A plain mask encodes no distance
 * around its edge, so the white ring cannot be the icon's halo — `map/layers.ts`
 * draws it as a layer underneath.
 *
 * Drawn at twice the size and declared as such, so they stay clean on a dense
 * screen.
 */
export function addShapes(map: MapLibreMap): void {
  for (const kind of KINDS) {
    if (map.hasImage(imageOf(kind))) continue
    map.addImage(imageOf(kind), mask(kind), { sdf: true, pixelRatio: 2 })
  }
}

function mask(kind: Kind): ImageData {
  const { draw, canvas } = shapeOf(kind, '#000')
  return draw.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * The same shape, as an image a legend can show beside a family's name.
 *
 * Drawn here rather than spelled out again in the stylesheet: a legend showing
 * a circle where the map draws a square says something false about the map, and
 * two drawings of one shape drift.
 */
export function swatchOf(kind: Kind, colour: string): string {
  return shapeOf(kind, colour).canvas.toDataURL()
}

/** The three shapes of the map, and the only place any of them is drawn. */
function shapeOf(
  kind: Kind,
  colour: string,
): { draw: CanvasRenderingContext2D; canvas: HTMLCanvasElement } {
  const [width, height] = SIZE[kind]
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2

  const draw = canvas.getContext('2d')
  if (draw === null) throw new Error('no 2d context to draw the map symbols with')

  draw.fillStyle = colour
  draw.beginPath()
  if (kind === 'watercourse') draw.arc(width, height, width - 1, 0, Math.PI * 2)
  else if (kind === 'structure') draw.rect(1, 1, width * 2 - 2, height * 2 - 2)
  else {
    draw.moveTo(width, 1)
    draw.lineTo(width * 2 - 1, height * 2 - 1)
    draw.lineTo(1, height * 2 - 1)
  }
  draw.closePath()
  draw.fill()

  return { draw, canvas }
}
