import type { RefObject } from 'react'

import { downloadCanvasPng, type LegendEntry } from '../download.ts'

/**
 * Saves the chart drawn inside an element as a PNG, as the Acycliq widget does,
 * with what the page writes around it drawn around it: what the chart shows
 * above it, what its marks stand for below it.
 */
export function ExportPng({
  area,
  filename,
  header,
  legend,
  disabled = false,
}: {
  /** What holds the chart: its first canvas is the drawing. */
  area: RefObject<HTMLElement | null>
  filename: string
  header: string
  legend: readonly LegendEntry[]
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="export-png"
      title="Télécharger le graphique en image PNG"
      aria-label="Télécharger le graphique en image PNG"
      disabled={disabled}
      onClick={() => {
        const canvas = area.current?.querySelector('canvas')
        if (!canvas) return
        const scale = canvas.width / canvas.clientWidth
        downloadCanvasPng(canvas, filename, { header, legend, scale })
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      PNG
    </button>
  )
}
