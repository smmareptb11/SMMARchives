import { z } from 'zod'

import {
  aquasysConfig,
  rainGaugeSchema,
  stationSchema,
  type RainGauge,
  type Station,
} from '@smmarchives/shared'

import { parseCliArgs, reportCollector, runScript, toExtent, toFamilies } from '../cli.ts'
import { AquasysClient } from '../sources/aquasys/client.ts'
import { fetchRainGauges, fetchStations } from '../sources/aquasys/stations.ts'

const SCRIPT = 'fetch:aquasys:stations'

const CONTRACT = z.object({
  stations: z.array(stationSchema),
  rainGauges: z.array(rainGaugeSchema),
})

/* eslint-disable-next-line max-statements -- a script body: the steps of the envelope contract, in
   order */
await runScript(CONTRACT, async () => {
  const args = parseCliArgs({
    family: { type: 'string' },
    bbox: { type: 'string' },
    'no-details': { type: 'boolean', default: false },
  })

  const families = toFamilies(args.family)
  const extent = toExtent(args.bbox)
  const withDetails = !args['no-details']
  const collector = reportCollector(SCRIPT, { families, extent: extent ?? null, withDetails })

  const client = new AquasysClient({ config: aquasysConfig() })
  const options = { client, collector, extent, withDetails }

  let stations: Station[] = []
  if (families.includes('hydro')) {
    collector.progress('hydrological stations…')
    stations = await fetchStations(options)
  }

  let rainGauges: RainGauge[] = []
  if (families.includes('rain-gauge')) {
    collector.progress('rain gauges…')
    rainGauges = await fetchRainGauges(options)
  }

  return {
    data: { stations, rainGauges },
    report: collector.seal(),
  }
})
