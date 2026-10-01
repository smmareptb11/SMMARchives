import { z } from 'zod'

import {
  dataTypesFor,
  measureSchema,
  rainGaugeSchema,
  stationSchema,
  thresholdSchema,
  type Measure,
  type ReplayIdentity,
  type SourceFamily,
} from '@smmarchives/shared'

import type { AquasysClient } from '../../sources/aquasys/client.ts'
import { fetchMeasures } from '../../sources/aquasys/measures.ts'
import { fetchRainGauges, fetchStations } from '../../sources/aquasys/stations.ts'
import { fetchThresholds } from '../../sources/aquasys/thresholds.ts'
import type { ReplayBuild } from '../build-state.ts'
import type { Derivable } from './events.ts'

export type AquasysSource = {
  client: AquasysClient
}

const REFERENTIAL = z.object({
  stations: z.array(stationSchema),
  rainGauges: z.array(rainGaugeSchema),
})

/**
 * Collects the Aquasys data sets off one referential, and derives the events.
 *
 * One lane rather than three collections, because Aquasys has no spatial
 * filter: each would resolve its own identifiers by loading a family
 * referential whole. Run separately they load it three times, and nothing makes
 * the three agree on the fleet — a station could be in the stations and absent
 * from the measures for no reason a reader could see.
 *
 * Loaded once here, the extent is applied once, and everything the lane stores
 * rests on the same fleet by construction.
 */
/* eslint-disable-next-line max-lines-per-function -- its body is the lane below, and the count is
   that lane's */
export async function collectAquasys(
  build: ReplayBuild,
  source: AquasysSource,
  identity: ReplayIdentity,
): Promise<Derivable | undefined> {
  const extent = identity.extent ?? undefined

  /* eslint-disable-next-line max-statements, max-lines-per-function -- three data sets off one
     referential, in the order they rest on each other; loading it once is why the lane exists */
  return build.runLane('aquasys', async () => {
    const referential = build.collectorFor('aquasys', {
      families: ['hydro', 'rain-gauge'],
      extent: identity.extent,
    })
    referential.progress('hydrological stations…')
    const options = { client: source.client, collector: referential, extent }
    const stations = await fetchStations(options)
    referential.progress('rain gauges…')
    const rainGauges = await fetchRainGauges(options)

    await build.stored(
      'stations',
      REFERENTIAL,
      { data: { stations, rainGauges }, report: referential.seal() },
      stations.length + rainGauges.length,
    )

    const stationIds = stations.map((one) => one.id)
    const gaugeIds = rainGauges.map((one) => one.id)

    const ladders = build.collectorFor('aquasys', {
      family: 'hydro',
      sources: stationIds.length,
    })
    const thresholds = await fetchThresholds({
      client: source.client,
      collector: ladders,
      sourceIds: stationIds,
    })
    await build.stored(
      'thresholds',
      z.array(thresholdSchema),
      { data: thresholds, report: ladders.seal() },
      thresholds.length,
    )

    const readings = build.collectorFor('aquasys', {
      from: identity.period.from,
      to: identity.period.to,
      families: ['hydro', 'rain-gauge'],
    })
    const measures: Measure[] = []
    const density = []
    let rowsDropped = 0
    // Summed per family, never pooled: the two number their sources
    // independently — 94 stations over 1 to 160, 229 rain gauges over 4 to 744
    // — so one identifier names one source of each, and a single set keyed on
    // it would count the pair as one.
    let withMeasures = 0

    for (const [family, sourceIds] of [
      ['hydro', stationIds],
      ['rain-gauge', gaugeIds],
    ] as Array<[SourceFamily, number[]]>) {
      const quantities = dataTypesFor(family).quantities()
      readings.progress(`measures of ${sourceIds.length} ${family} source(s)…`)
      const result = await fetchMeasures({
        client: source.client,
        collector: readings,
        family,
        sourceIds,
        quantities,
        window: identity.period,
      })
      measures.push(...result.measures)
      density.push(...result.density)
      rowsDropped += result.rowsDropped

      const answered = new Set<number>()
      for (const one of result.measures) answered.add(one.sourceId)
      withMeasures += answered.size
    }

    await build.stored(
      'measures',
      z.array(measureSchema),
      { data: measures, report: readings.seal({ density, rowsDropped }) },
      measures.length,
    )

    // The fleet of a replay is deduced from the measures, never from
    // referential dates: `creationDate` takes negative values and `closeDate`
    // is nearly always absent.
    await build.counted({
      inExtent: stations.length + rainGauges.length,
      withMeasures,
    })

    // Returned rather than derived here: what the collection implies is
    // another lane's business, and a bug in it must not condemn this one.
    return { measures, thresholds, stations }
  })
}
