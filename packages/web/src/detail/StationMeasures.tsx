import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'
import type { LevelDatum } from '@smmarchives/shared/contracts/station.ts'
import type { Threshold } from '@smmarchives/shared/contracts/threshold.ts'

import { useMemo, useRef, useState, type RefObject } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { formatSince } from '../time.ts'
import { instantAt, type Cursor } from '../transport/reading.ts'
import { CURVE_HEIGHT, SPANS, STATION_SPAN, type Span } from './chart.ts'
import {
  LEVEL_DATUMS,
  NAMED,
  formatValue,
  ladderIn,
  ladderOf,
  levelSeriesIn,
  levelView,
  openedQuantity,
  quantitiesFor,
  unitIn,
  valueAt,
  type LevelView,
  type Rung,
  type Series,
} from './series.ts'
import { exportName } from '../download.ts'
import { ExportPng } from './ExportPng.tsx'
import { legendOf } from './legend.ts'
import { PillPicker } from './PillPicker.tsx'
import { StationChart } from './StationChart.tsx'
import { ThresholdLegend } from './ThresholdLegend.tsx'
import type { Measured } from './measured.ts'
import { useMeasures } from './useMeasures.ts'

/**
 * What a station measured: the value at the instant being read, and the curve
 * of the hours around it, in the quantity the reader picks.
 *
 * What the map cannot give: a colour says which threshold is crossed, and never
 * how high the water is, nor whether it is still rising.
 */
export function StationMeasures({
  replayId,
  sourceId,
  name,
  thresholds,
  ngfDatum,
  levelDatum,
  period,
  at,
}: {
  replayId: string
  sourceId: number
  /** The station's name, which the image of its chart is saved under. */
  name: string
  thresholds: readonly Threshold[]
  /** The NGF altitude of the station's gauge zero, if its history gives one. */
  ngfDatum: number | null
  /** What the source measures the station's level from. */
  levelDatum: LevelDatum
  period: TimeWindow
  at: Cursor
}) {
  const [span, setSpan] = useState<Span>(STATION_SPAN)
  // The map and the lanes go on showing the quantity watched, whatever the
  // reader picks here.
  const [quantity, setQuantity] = useState<Quantity>(() => openedQuantity(thresholds, sourceId))
  const [datum, setDatum] = useState<LevelDatum>('gauge')
  // What the pill shows and what the chart draws both follow it.
  const view = quantity === 'level' ? levelView(levelDatum, datum, ngfDatum) : null
  const ladder = useMemo(
    () => ladderOf(thresholds, sourceId, quantity),
    [thresholds, sourceId, quantity],
  )
  const { level, flow } = useOfferedMeasures(replayId, sourceId)
  const shown = useLevelView(quantity === 'flow' ? flow : level, ladder, view)
  const quantities = quantitiesFor({ level: level.series, flow: flow.series })
  const area = useRef<HTMLDivElement>(null)
  const unit = unitIn(quantity, view)

  return (
    <>
      {/* Above whatever the quantity holds, so a quantity measuring nothing
          never takes away the way back to the other. */}
      <div className="pickers">
        <PillPicker label="Plage de temps" options={SPANS} chosen={span} onPick={setSpan} />
        <PillPicker label="Grandeur" options={quantities} chosen={quantity} onPick={setQuantity} />
        {view === null ? null : (
          <DatumPicker chosen={view.datum} known={ngfDatum !== null} onPick={setDatum} />
        )}
        <StationExport {...{ area, name, sourceId, quantity, unit, shown }} />
      </div>
      <Curve {...shown} {...{ sourceId, quantity, at, span, period, area }} datum={view?.datum} />
      <ThresholdLegend ladder={shown.ladder} unit={unit} />
    </>
  )
}

/**
 * The measures of each quantity the chart offers, all read as the window
 * opens: a quantity measuring nothing is greyed out before anyone picks it.
 */
function useOfferedMeasures(replayId: string, sourceId: number) {
  return {
    level: useMeasures(replayId, sourceId, 'level'),
    flow: useMeasures(replayId, sourceId, 'flow'),
  }
}

/**
 * Saving the chart as an image, named and with its legend: the station, the
 * quantity and its unit above it, the thresholds it rules below it.
 */
function StationExport({
  area,
  name,
  sourceId,
  quantity,
  unit,
  shown,
}: {
  area: RefObject<HTMLDivElement | null>
  name: string
  sourceId: number
  quantity: Quantity
  unit: string
  shown: Measured & { ladder: Rung[] }
}) {
  return (
    <ExportPng
      area={area}
      filename={exportName([NAMED[quantity], name, sourceId])}
      header={`${name} · ${NAMED[quantity]} (${unit})`}
      legend={legendOf(shown.ladder, unit).map((line) => ({
        colour: line.colour,
        text: line.said,
        mark: 'dash' as const,
      }))}
      disabled={!shown.series?.points.length}
    />
  )
}

/** The two ways a level reads, offered only where the station's gauge zero is known. */
function DatumPicker({
  chosen,
  known,
  onPick,
}: {
  chosen: LevelDatum
  known: boolean
  onPick: (datum: LevelDatum) => void
}) {
  return (
    <PillPicker
      label="Référence des hauteurs"
      options={LEVEL_DATUMS}
      chosen={chosen}
      onPick={onPick}
      unavailable={known ? undefined : UNKNOWN_DATUM}
    />
  )
}

/** Why a station offers no metres NGF. */
const UNKNOWN_DATUM = 'Cote NGF du zéro d’échelle inconnue pour cette station'

/**
 * The measures and the ladder as a level view shows them, untouched without one.
 *
 * Both are kept the same objects from one frame to the next: the chart is
 * rebuilt whenever its series changes, and the window renders on every tick.
 */
function useLevelView(
  { series, failure }: Measured,
  ladder: Rung[],
  view: LevelView | null,
): Measured & { ladder: Rung[] } {
  const datum = view?.datum
  const shift = view?.shift ?? 0
  const moved = useMemo(
    () =>
      series === undefined || datum === undefined
        ? series
        : levelSeriesIn(series, { datum, shift }),
    [series, datum, shift],
  )
  const rungs = useMemo(
    () => (datum === undefined ? ladder : ladderIn(ladder, { datum, shift })),
    [ladder, datum, shift],
  )

  return { series: moved, failure, ladder: rungs }
}

/** The value and the curve of one quantity, or what stands in for them. */
function Curve({
  series,
  failure,
  sourceId,
  quantity,
  ladder,
  at,
  span,
  period,
  datum,
  area,
}: Measured & {
  sourceId: number
  quantity: Quantity
  /** The datum a level is shown from; none for another quantity. */
  datum: LevelDatum | undefined
  ladder: readonly Rung[]
  at: Cursor
  span: Span
  period: TimeWindow
  /** Where the image of the chart is taken from. */
  area: RefObject<HTMLDivElement | null>
}) {
  // Holding the room the value and the curve will take, from the very first
  // frame: the window would otherwise grow under the reader's eyes once the
  // measures arrive, and shrink when a quantity holds none or fails to be read.
  if (failure !== undefined) return <InPlaceOfCurve said={failure} refused />
  if (series === undefined) return <InPlaceOfCurve said="Lecture des mesures…" />

  // Naming the quantity, because the station may well measure the other one: a
  // bare « aucune mesure » would read as a station that measured nothing.
  if (series.points.length === 0) {
    return <InPlaceOfCurve said={`Aucune mesure de ${NAMED[quantity]} dans la période.`} />
  }

  return (
    <>
      <Value series={series} at={at} />
      {/* Another station, another quantity or another datum is another chart,
          and never the same one handed a new ladder: what the chart reads once
          when it is built cannot go stale. */}
      <div className="exported" ref={area}>
        <StationChart
          key={`${String(sourceId)} ${quantity} ${datum ?? ''}`}
          series={series}
          ladder={ladder}
          at={at}
          span={span}
          period={period}
        />
      </div>
    </>
  )
}

/**
 * What is said where the value and the curve would be, in the room they take:
 * a line as tall as the value's, left blank, and the curve's own height.
 */
function InPlaceOfCurve({ said, refused = false }: { said: string; refused?: boolean }) {
  return (
    <>
      <p className="measured" aria-hidden="true">
        {'\u00a0'}
      </p>
      <div className="awaited" style={{ height: CURVE_HEIGHT }}>
        <p className={refused ? 'refusal' : 'note'}>{said}</p>
      </div>
    </>
  )
}

/** What the station last measured before the instant being read. */
function Value({ series, at }: { series: Series; at: Cursor }) {
  const reading = valueAt(series.points, at)
  if (reading === undefined) return <p className="note">Avant la première mesure.</p>

  return (
    <p className="measured">
      {formatValue(reading.value)} {series.unit}
      <small> {formatSince(instantAt(reading.at), instantAt(at))}</small>
    </p>
  )
}
