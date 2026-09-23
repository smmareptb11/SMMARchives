import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'
import type { Threshold } from '@smmarchives/shared/contracts/threshold.ts'

import { formatHour } from '../time.ts'
import { instantAt, type Cursor } from '../transport/reading.ts'
import { CURVE_HEIGHT } from './chart.ts'
import {
  floodMarksOf,
  formatValue,
  ladderOf,
  valueAt,
  watchedQuantity,
  type Series,
} from './series.ts'
import { StationChart } from './StationChart.tsx'
import { useMeasures } from './useMeasures.ts'

/** How the interface names a quantity when it says it has none of it. */
const NAMED: Record<Quantity, string> = {
  level: 'hauteur',
  flow: 'débit',
  rainfall: 'pluie',
}

/**
 * What a station measured: the value at the instant being read, and the curve
 * of the hours around it.
 *
 * What the map cannot give: a colour says which threshold is crossed, and never
 * how high the water is, nor whether it is still rising.
 */
export function StationMeasures({
  replayId,
  sourceId,
  thresholds,
  at,
}: {
  replayId: string
  sourceId: number
  thresholds: readonly Threshold[]
  at: Cursor
}) {
  const quantity = watchedQuantity(thresholds, sourceId)
  const ladder = ladderOf(thresholds, sourceId, quantity)
  const { series, failure } = useMeasures(replayId, sourceId, quantity)

  if (failure !== undefined) return <p className="refusal">{failure}</p>

  // Holding the room the curve will take, from the very first frame: MapLibre
  // picks which side of the source to open the bubble on by measuring it, and
  // a bubble that grew once the measures arrived would flip sides under the
  // reader's eyes.
  if (series === undefined) {
    return (
      <div className="awaited" style={{ height: CURVE_HEIGHT }}>
        <p className="note">Lecture des mesures…</p>
      </div>
    )
  }

  // Naming the quantity, because the station may well measure another one: a
  // bare « aucune mesure » would read as a station that measured nothing.
  if (series.points.length === 0) {
    return <p className="note">Aucune mesure de {NAMED[quantity]} dans la période.</p>
  }

  return (
    <>
      <Value series={series} at={at} />
      {/* Another station is another chart, and never the same one handed a new
          ladder: what the chart reads once when it is built cannot go stale. */}
      <StationChart
        key={`${String(sourceId)} ${quantity}`}
        series={series}
        ladder={ladder}
        at={at}
      />
      <PastFloods marks={floodMarksOf(thresholds, sourceId)} />
    </>
  )
}

/** What the station carries beside its ladder, and the curve never draws. */
function PastFloods({ marks }: { marks: number }) {
  if (marks === 0) return null

  return (
    <p className="note">
      Cette station porte aussi{' '}
      {marks === 1
        ? 'un repère de crue passée, qui n’est pas un seuil'
        : `${String(marks)} repères de crue passée, qui ne sont pas des seuils`}
      .
    </p>
  )
}

/** What the station last measured before the instant being read. */
function Value({ series, at }: { series: Series; at: Cursor }) {
  const reading = valueAt(series.points, at)
  if (reading === undefined) return <p className="note">Avant la première mesure.</p>

  return (
    <p className="measured">
      {formatValue(reading.value)} {series.unit}
      <small> à {formatHour(instantAt(reading.at))}</small>
    </p>
  )
}
