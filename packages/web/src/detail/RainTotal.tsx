import { UNITS } from '@smmarchives/shared'

import { useMemo } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { rainAt, stepsOf, stepSaid, type Gauge, type Rain } from '../rain.ts'
import { formatInstant } from '../time.ts'
import { instantAt, type Cursor } from '../transport/reading.ts'
import { RainChart } from './RainChart.tsx'
import { formatValue } from './series.ts'

/**
 * What a rain gauge measured: the total reached, and every measure behind it.
 *
 * What the map cannot give even coloured: a shade says a bracket, never the
 * figure, and never how that figure was gathered. The chart is what says the
 * second part — a total of ninety millimetres taken in one daily reading and
 * one gathered hour by hour are the same shade and not the same episode.
 */
export function RainTotal({
  gauges,
  sourceId,
  period,
  at,
}: {
  gauges: Map<number, Gauge>
  sourceId: number
  period: TimeWindow
  at: Cursor
}) {
  const gauge = gauges.get(sourceId)
  // Run out of the running totals once per gauge, where the bubble repaints on
  // every frame of the reading and the chart is rebuilt whenever they change.
  const steps = useMemo(() => (gauge === undefined ? [] : stepsOf(gauge)), [gauge])

  if (gauge === undefined) return <p className="note">Aucune mesure de pluie dans la période.</p>

  return (
    <>
      <Reached rain={rainAt(gauge, at)} />
      <RainChart steps={steps} period={period} at={at} />
    </>
  )
}

/**
 * The total the reading has reached, and where that figure comes from.
 *
 * Nothing reached is still said, and the chart under it is drawn all the same:
 * the gauge's measures are ahead of the reading, not absent, and the bars are
 * what show the difference.
 */
function Reached({ rain }: { rain: Rain }) {
  const gathered = stepSaid(rain.stepMinutes)

  if (rain.last === undefined) return <p className="note">Avant la première mesure. {gathered}</p>

  return (
    <>
      <p className="measured">
        {formatValue(rain.millimetres)} {UNITS.rainfall}
        <small> depuis le début de la période</small>
      </p>
      {/* The date and not the hour alone: a daily gauge's last measure can be
          two days behind the cursor, where a station's is thirteen minutes. */}
      <p className="note">
        Dernière mesure : {formatInstant(instantAt(rain.last))}. {gathered}
      </p>
    </>
  )
}
