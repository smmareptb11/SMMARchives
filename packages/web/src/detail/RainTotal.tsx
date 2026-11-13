import { UNITS } from '@smmarchives/shared'

import { useMemo, useRef, useState } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { rainAt, stepsOf, type Gauge, type Rain } from '../rain.ts'
import type { Cursor } from '../transport/reading.ts'
import { RAIN_SPAN, SPANS, type Span } from './chart.ts'
import { RainChart } from './RainChart.tsx'
import { AHEAD, barsLabel } from './rain-chart.ts'
import { formatValue } from './series.ts'
import { exportName, type LegendEntry } from '../download.ts'
import { CUMUL, RAIN } from '../palette.ts'
import { ExportPng } from './ExportPng.tsx'
import { PillPicker } from './PillPicker.tsx'

/**
 * What a rain gauge measured: the total reached, and every measure behind it,
 * which the map's shade cannot say: ninety millimetres in one daily reading and
 * ninety gathered hour by hour are one shade and two episodes.
 */
export function RainTotal({
  gauges,
  sourceId,
  name,
  period,
  at,
}: {
  gauges: Map<number, Gauge>
  sourceId: number
  /** The gauge's name, which the image of its chart is saved under. */
  name: string
  period: TimeWindow
  at: Cursor
}) {
  const gauge = gauges.get(sourceId)
  // Once per gauge: the bubble repaints on every frame, and the chart is rebuilt
  // whenever the steps change.
  const steps = useMemo(() => (gauge === undefined ? [] : stepsOf(gauge)), [gauge])
  const [span, setSpan] = useState<Span>(RAIN_SPAN)
  const area = useRef<HTMLDivElement>(null)

  if (gauge === undefined) return <p className="note">Aucune mesure de pluie dans la période.</p>

  return (
    <>
      <Reached rain={rainAt(gauge, at)} />
      <div className="pickers">
        <PillPicker label="Plage de temps" options={SPANS} chosen={span} onPick={setSpan} />
        <ExportPng
          area={area}
          filename={exportName(['pluie', name, sourceId])}
          header={`${name} · pluie (${UNITS.rainfall})`}
          legend={legendFor(barsLabel(gauge.stepMinutes))}
        />
      </div>
      <div className="exported" ref={area}>
        <RainChart steps={steps} period={period} at={at} span={span} />
      </div>
      <Legend bars={barsLabel(gauge.stepMinutes)} />
    </>
  )
}

/** The legend below, drawn under the image of the chart. */
function legendFor(bars: string): LegendEntry[] {
  return [
    { colour: RAIN, text: `${bars} (mm)`, mark: 'block' },
    { colour: CUMUL, text: CUMUL_LABEL, mark: 'line' },
    { colour: RAIN, text: AHEAD_LABEL, mark: 'block', opacity: AHEAD },
  ]
}

const CUMUL_LABEL = 'Cumul pluvio sur l’intervalle (mm)'
const AHEAD_LABEL = 'Après l’instant lu'

/** What the bars and the curve stand for, worded as the Acycliq widget words them. */
function Legend({ bars }: { bars: string }) {
  return (
    <ul className="rain-legend" aria-label="Légende pluviométrie">
      <li>
        <span className="swatch bars" aria-hidden="true" />
        {bars} (mm)
      </li>
      <li>
        <span className="swatch total" aria-hidden="true" />
        {CUMUL_LABEL}
      </li>
      {/* Faint is a choice, and one nothing else on the screen would explain. */}
      <li>
        <span className="swatch bars" style={{ opacity: AHEAD }} aria-hidden="true" />
        {AHEAD_LABEL}
      </li>
    </ul>
  )
}

/**
 * The total the reading has reached. Before the first measure, the chart under
 * it is drawn all the same: its measures are ahead, not absent.
 */
function Reached({ rain }: { rain: Rain }) {
  if (rain.last === undefined) return <p className="note">Avant la première mesure.</p>

  return (
    <p className="measured">
      {formatValue(rain.millimetres)} {UNITS.rainfall}
      <small> depuis le début de la période</small>
    </p>
  )
}
