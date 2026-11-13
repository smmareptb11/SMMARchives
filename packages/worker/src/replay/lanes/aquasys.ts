import { z } from 'zod'

import {
  dataTypesFor,
  measureSchema,
  networkRules,
  thresholdLabelRules,
  measuredStationsSchema,
  rainGaugeSchema,
  stationSchema,
  thresholdSchema,
  type ReplayIdentity,
  type SourceFamily,
} from '@smmarchives/shared'

import type { AquasysClient } from '../../sources/aquasys/client.ts'
import { fetchMeasures, type MeasuresResult } from '../../sources/aquasys/measures.ts'
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
 * Collects the Aquasys data sets off one referential, loaded once and cropped
 * once, so that everything the lane stores rests on the same fleet.
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
      networks: networkRules(),
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

    // Hydro only: no rain gauge of the fleet carries a threshold worth freezing.
    const ladders = build.collectorFor('aquasys', {
      family: 'hydro',
      sources: stationIds.length,
      labels: thresholdLabelRules(),
    })
    const thresholds = await fetchThresholds({
      client: source.client,
      collector: ladders,
      family: 'hydro',
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
    const perFamily: MeasuresResult[] = []
    let rowsDropped = 0
    // Per family, never pooled: one identifier names one source of each family.
    const answered: Record<SourceFamily, Set<number>> = {
      hydro: new Set(),
      'rain-gauge': new Set(),
    }

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
      perFamily.push(result)
      rowsDropped += result.rowsDropped

      for (const one of result.measures) answered[family].add(one.sourceId)
    }

    const measures = perFamily.flatMap((one) => one.measures)
    const density = perFamily.flatMap((one) => one.density)

    await build.stored(
      'measures',
      z.array(measureSchema),
      { data: measures, report: readings.seal({ density, rowsDropped }) },
      measures.length,
    )
    const measuredStations = [...answered.hydro]
    await build.stored(
      'measured-stations',
      measuredStationsSchema,
      {
        data: measuredStations.sort((one, other) => one - other),
        report: build
          .collectorFor('aquasys', { from: identity.period.from, to: identity.period.to })
          .seal(),
      },
      measuredStations.length,
    )

    // Deduced from the measures, never from the referential's dates.
    await build.counted({
      hydro: { inExtent: stations.length, withMeasures: answered.hydro.size },
      'rain-gauge': { inExtent: rainGauges.length, withMeasures: answered['rain-gauge'].size },
    })

    // Derived by another lane, so that a bug there does not condemn this one.
    return { measures, thresholds, stations }
  })
}
