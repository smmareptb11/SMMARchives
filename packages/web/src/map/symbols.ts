import type { Map as MapLibreMap } from 'maplibre-gl'

import { KINDS, type Kind } from './sources.ts'

/** The three sources of the mockup, and the diamond of what an agent reported. */
export type Shape = Kind | 'report'

const SHAPES: readonly Shape[] = [...KINDS, 'report']

/**
 * The shapes of the mockup, in the sizes it drew them at.
 *
 * A rain gauge is wider than it is tall because a triangle reads as a triangle
 * only when its base is wide enough to be seen. A diamond is a square on its
 * point, so it is drawn wider than the square to look as large.
 */
const SIZE: Record<Shape, [number, number]> = {
  watercourse: [15, 15],
  structure: [14, 14],
  'rain-gauge': [18, 16],
  report: [18, 18],
}

/**
 * How thick the white ring is, in pixels of the drawn shape.
 *
 * A width and not a scale: scaled, a ring would be thicker around a diamond
 * than around the square of a structure, for no reason a reader could name.
 */
export const RING = 2.5

/** How far the outline of a selected source reaches past its ring, in pixels. */
export const OUTLINE = 3

/**
 * How far a mitred corner reaches past a shape, in widths of what is drawn
 * around it: the triangle's top, the sharpest corner, reaches about twice.
 */
const MITRE_ROOM = 2.5

/** The mockup's shadow under a marker, in pixels: how far it drops, and how much it blurs. */
const SHADOW = { drop: 2, blur: 5, colour: 'rgb(0 0 0 / 40%)' }

/** Room around a shadow's image for its blur and its drop. */
const SHADOW_ROOM = 8

/** So a shape drawn for one map is not redrawn for the next. */
export const imageOf = (shape: Shape): string => `source-${shape}`

export const shadowImageOf = (shape: Shape): string => `shadow-${shape}`

/** The white ring around a shape. */
export const ringImageOf = (shape: Shape): string => `ring-${shape}`

/** The outline around the ring of a selected source, in the source's own colour. */
export const haloImageOf = (shape: Shape): string => `halo-${shape}`

export function isShape(one: unknown): one is Shape {
  return SHAPES.includes(one as Shape)
}

/**
 * Draws the three shapes once into the map's own sprite.
 *
 * Registered as signed distance fields, which is what lets a single paint
 * property tint the whole parc at a tick: a plain icon cannot be recoloured,
 * and recolouring is what the cursor is for. A plain mask encodes no distance
 * around its edge, so the white ring cannot be the icon's halo — `map/layers.ts`
 * draws it as a layer underneath, from an image of its own, as it does the
 * outline of a selected source.
 *
 * Their shadows are plain images beside them: a shadow is black whatever the
 * cursor reads, so it needs no recolouring, and a plain image is what can carry
 * a blur.
 *
 * Drawn at twice the size and declared as such, so they stay clean on a dense
 * screen.
 */
export function addShapes(map: MapLibreMap): void {
  for (const shape of SHAPES) {
    if (map.hasImage(imageOf(shape))) continue
    map.addImage(imageOf(shape), mask(shape), { sdf: true, pixelRatio: 2 })
    map.addImage(ringImageOf(shape), around(shape, RING), { sdf: true, pixelRatio: 2 })
    map.addImage(haloImageOf(shape), around(shape, RING + OUTLINE), { sdf: true, pixelRatio: 2 })
    map.addImage(shadowImageOf(shape), shadow(shape), { pixelRatio: 2 })
  }
}

/**
 * The shape grown by `reach` pixels on every side, centred where the shape is.
 *
 * Its outline stroked rather than the shape scaled up: scaled about its middle,
 * a triangle grows twice as much under its base as along its sides, where a
 * stroke is as thick all round. Mitred, so a corner stays a corner.
 */
function around(shape: Shape, reach: number): ImageData {
  const [width, height] = SIZE[shape]
  const room = Math.ceil(reach * MITRE_ROOM)
  const { draw, canvas } = canvasOf(width + 2 * room, height + 2 * room)
  draw.translate(room * 2, room * 2)
  grown(draw, shape, reach)

  return draw.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * The shadow of a shape on its ring.
 *
 * The shape is drawn off the canvas and its shadow thrown back onto it: a
 * shadow cast by a shape drawn in place would come with the shape on top.
 */
function shadow(shape: Shape): ImageData {
  const [width, height] = SIZE[shape]
  const room = SHADOW_ROOM + Math.ceil(RING * MITRE_ROOM)

  const { draw, canvas } = canvasOf(width + 2 * room, height + 2 * room)
  draw.shadowColor = SHADOW.colour
  draw.shadowBlur = SHADOW.blur * 2
  draw.shadowOffsetX = canvas.width
  draw.shadowOffsetY = SHADOW.drop * 2
  draw.translate(room * 2 - canvas.width, room * 2)
  grown(draw, shape, RING)

  return draw.getImageData(0, 0, canvas.width, canvas.height)
}

/** The shape, filled and stroked `reach` pixels past its edge, at twice the size. */
function grown(draw: CanvasRenderingContext2D, shape: Shape, reach: number): void {
  const [width, height] = SIZE[shape]
  draw.fillStyle = '#000'
  draw.strokeStyle = '#000'
  // Half a stroke lies outside the edge, and the canvas is drawn at twice the size.
  draw.lineWidth = reach * 2 * 2
  draw.lineJoin = 'miter'
  draw.beginPath()
  trace(draw, shape, width, height)
  draw.closePath()
  draw.fill()
  draw.stroke()
}

function mask(shape: Shape): ImageData {
  const { draw, canvas } = shapeOf(shape, '#000')
  return draw.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * The same shape, as an image a legend can show beside a family's name.
 *
 * Drawn here rather than spelled out again in the stylesheet: a legend showing
 * a circle where the map draws a square says something false about the map, and
 * two drawings of one shape drift.
 */
export function swatchOf(shape: Shape, colour: string): string {
  return shapeOf(shape, colour).canvas.toDataURL()
}

/** The shapes of the map, and the only place any of them is drawn. */
function shapeOf(
  shape: Shape,
  colour: string,
): { draw: CanvasRenderingContext2D; canvas: HTMLCanvasElement } {
  const [width, height] = SIZE[shape]
  const { draw, canvas } = canvasOf(width, height)
  draw.fillStyle = colour
  draw.beginPath()
  trace(draw, shape, width, height)
  draw.closePath()
  draw.fill()

  return { draw, canvas }
}

/** A canvas at twice the size asked, as every image of the sprite is drawn. */
function canvasOf(
  width: number,
  height: number,
): { draw: CanvasRenderingContext2D; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2

  const draw = canvas.getContext('2d')
  if (draw === null) throw new Error('no 2d context to draw the map symbols with')
  return { draw, canvas }
}

/** The outline of a shape, drawn at twice its size. */
function trace(draw: CanvasRenderingContext2D, shape: Shape, width: number, height: number): void {
  if (shape === 'watercourse') draw.arc(width, height, width - 1, 0, Math.PI * 2)
  else if (shape === 'structure') draw.rect(1, 1, width * 2 - 2, height * 2 - 2)
  else if (shape === 'report') {
    draw.moveTo(width, 1)
    draw.lineTo(width * 2 - 1, height)
    draw.lineTo(width, height * 2 - 1)
    draw.lineTo(1, height)
  } else {
    draw.moveTo(width, 1)
    draw.lineTo(width * 2 - 1, height * 2 - 1)
    draw.lineTo(1, height * 2 - 1)
  }
}
