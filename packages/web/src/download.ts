import { instantAt, type Cursor } from './transport/reading.ts'
import { toLocalInput } from './time.ts'

/** Beyond it a name stops being usable, and some file systems cap a name at 255 bytes. */
const MOST = 60

/**
 * A part of a file name: accents unfolded then dropped, anything else that is
 * not a letter or a figure turned into a dash.
 * « Ruisseau de la Nère à Villefranche » → `ruisseau-de-la-nere-a-villefranche`.
 */
export function slugify(text: string | number | null | undefined): string {
  if (text === null || text === undefined) return ''
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MOST)
    .replace(/-+$/g, '')
}

/**
 * The name an image is saved under, its parts in order and an empty one left
 * out: `smmarchives-debit-trebes-84.png`.
 */
export function exportName(parts: readonly (string | number | null | undefined)[]): string {
  return `${['smmarchives', ...parts.map(slugify)].filter(Boolean).join('-')}.png`
}

/** The map's image, named after its replay and the instant read, in French time. */
export function mapExportName(label: string | null, at: Cursor): string {
  // `2019-10-22T14:00` read as a name: the day, then the hour.
  const [day, hour] = toLocalInput(instantAt(at)).split('T')
  return exportName(['carte', label, day, hour?.replace(':', 'h')])
}

/** How an entry of a legend is marked: the way the chart draws what it names. */
export type Mark = 'dash' | 'line' | 'block'

/** One entry of a legend drawn under a chart, faint where the chart draws it faint. */
export type LegendEntry = { colour: string; text: string; mark: Mark; opacity?: number }

/** Where an entry of a legend goes: its row, and how far from the left it starts. */
export type Placed = { row: number; x: number }

/**
 * The entries laid out in rows within the room given, each row centred as the
 * screen centres it, an entry wider than the room alone on its own row.
 */
export function placeLegend(widths: readonly number[], room: number, gap: number): Placed[] {
  const rows: number[][] = []
  let used = Infinity
  widths.forEach((width, index) => {
    if (used + gap + width > room) {
      rows.push([])
      used = -gap
    }
    rows.at(-1)?.push(index)
    used += gap + width
  })

  const placed: Placed[] = []
  rows.forEach((row, rowIndex) => {
    const total = row.reduce((sum, index) => sum + (widths[index] ?? 0), 0) + gap * (row.length - 1)
    let x = Math.max(0, (room - total) / 2)
    for (const index of row) {
      placed[index] = { row: rowIndex, x }
      x += (widths[index] ?? 0) + gap
    }
  })
  return placed
}

/** What is written around an image, beside the drawing itself. */
export type Around = {
  background?: string
  /** Device pixels per CSS pixel of the drawing, so the text is the size the page shows. */
  scale?: number
  /** A line above the drawing, naming what it shows. */
  header?: string
  legend?: readonly LegendEntry[]
  /** Written in the bottom right corner of the drawing. */
  credit?: string
}

/**
 * Saves a canvas as a PNG under the name given, on an opaque background, with
 * what is to be written around it.
 *
 * Copied onto a second canvas first: uPlot paints no background. Through a
 * `blob:` address, as a `data:` one meets the browsers' limits on a large image;
 * the link is put in the page before it is clicked, which some browsers require.
 */
export function downloadCanvasPng(
  canvas: HTMLCanvasElement,
  filename: string,
  around: Around = {},
): void {
  composed(canvas, around)?.toBlob((blob) => {
    if (blob === null) return
    const address = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = filename
    link.href = address
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
    // Later rather than now: the address has to outlive the click.
    setTimeout(() => URL.revokeObjectURL(address), 1000)
  }, 'image/png')
}

/** Sizes in CSS pixels, scaled to the drawing's own when drawn. */
const TEXT = 12
const TITLE = 14
const PADDING = 10
const SWATCH = 24
const SWATCH_GAP = 6
const ENTRY_GAP = 16
const ROW = 20
const FONT = "'IBM Plex Sans', system-ui, sans-serif"
const INK = '#1c2833'
const INK_2 = '#536372'

/** Where each part of the image goes, in the drawing's own pixels. */
type Layout = { scale: number; header: number; drawing: number; legend: number; placed: Placed[] }

/** The drawing with its header above it, its legend below it and its credit in its corner. */
function composed(canvas: HTMLCanvasElement, around: Around): HTMLCanvasElement | undefined {
  const flattened = document.createElement('canvas')
  const context = flattened.getContext('2d')
  if (context === null) return undefined
  const layout = layoutOf(context, canvas, around)

  flattened.width = canvas.width
  flattened.height = layout.header + layout.drawing + layout.legend
  context.fillStyle = around.background ?? '#ffffff'
  context.fillRect(0, 0, flattened.width, flattened.height)
  context.drawImage(canvas, 0, layout.header)
  context.textBaseline = 'middle'

  if (around.header !== undefined) writeHeader(context, around.header, layout)
  if (around.credit !== undefined) writeCredit(context, around.credit, layout)
  writeLegend(context, around.legend ?? [], layout)
  return flattened
}

function layoutOf(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  { scale = 1, header, legend = [] }: Around,
): Layout {
  context.font = `${String(TEXT * scale)}px ${FONT}`
  const widths = legend.map(
    (one) => (SWATCH + SWATCH_GAP) * scale + context.measureText(one.text).width,
  )
  const placed = placeLegend(widths, canvas.width - 2 * PADDING * scale, ENTRY_GAP * scale)
  const rows = placed.reduce((most, one) => Math.max(most, one.row + 1), 0)
  return {
    scale,
    header: header === undefined ? 0 : (TITLE + 2 * PADDING) * scale,
    drawing: canvas.height,
    legend: rows === 0 ? 0 : (rows * ROW + 2 * PADDING) * scale,
    placed,
  }
}

function writeHeader(context: CanvasRenderingContext2D, text: string, layout: Layout): void {
  context.font = `600 ${String(TITLE * layout.scale)}px ${FONT}`
  context.fillStyle = INK
  context.fillText(text, PADDING * layout.scale, layout.header / 2)
}

function writeLegend(
  context: CanvasRenderingContext2D,
  legend: readonly LegendEntry[],
  { scale, header, drawing, placed }: Layout,
): void {
  context.font = `${String(TEXT * scale)}px ${FONT}`
  legend.forEach((entry, index) => {
    const at = placed[index]
    if (at === undefined) return
    const x = PADDING * scale + at.x
    const y = header + drawing + (PADDING + at.row * ROW + ROW / 2) * scale
    drawMark(context, entry, { x, y, scale })
    context.fillStyle = INK_2
    context.fillText(entry.text, x + (SWATCH + SWATCH_GAP) * scale, y)
  })
}

/** The mark of an entry, drawn the way the chart draws what it names. */
function drawMark(
  context: CanvasRenderingContext2D,
  { colour, mark, opacity = 1 }: LegendEntry,
  { x, y, scale }: { x: number; y: number; scale: number },
): void {
  context.save()
  context.globalAlpha = opacity
  if (mark === 'block') {
    context.fillStyle = colour
    context.fillRect(x + 5 * scale, y - 7 * scale, 14 * scale, 14 * scale)
  } else {
    context.strokeStyle = colour
    context.lineWidth = 2 * scale
    if (mark === 'dash') context.setLineDash([4 * scale, 3 * scale])
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + SWATCH * scale, y)
    context.stroke()
  }
  context.restore()
}

/** The credit, in the drawing's bottom right corner, on a pale band so it reads on any ground. */
function writeCredit(context: CanvasRenderingContext2D, text: string, layout: Layout): void {
  const size = 11 * layout.scale
  const padding = 4 * layout.scale
  context.font = `${String(size)}px ${FONT}`
  const width = context.measureText(text).width + 2 * padding
  const height = size + 2 * padding
  const right = context.canvas.width
  const bottom = layout.header + layout.drawing
  context.fillStyle = 'rgb(255 255 255 / 80%)'
  context.fillRect(right - width, bottom - height, width, height)
  context.fillStyle = '#333333'
  context.fillText(text, right - width + padding, bottom - height / 2)
}
