import type { CSSProperties } from 'react'

import { legendOf } from './legend.ts'
import type { Rung } from './series.ts'

/** What the dashed lines behind the curve are, under it. */
export function ThresholdLegend({ ladder, unit }: { ladder: readonly Rung[]; unit: string }) {
  if (ladder.length === 0) return null

  return (
    <ul className="rain-legend threshold-legend" aria-label="Seuils d’alerte">
      {legendOf(ladder, unit).map((line) => (
        <li key={line.said} title={line.why}>
          <span
            className="swatch rung"
            style={{ '--rung': line.colour } as CSSProperties}
            aria-hidden="true"
          />
          {line.said}
        </li>
      ))}
    </ul>
  )
}
