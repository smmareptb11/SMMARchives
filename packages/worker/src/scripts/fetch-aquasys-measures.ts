import { z } from 'zod'

import {
  aquasysConfig,
  dataTypesFor,
  measureSchema,
  quantitySchema,
  type Quantity,
  type SourceFamily,
} from '@smmarchives/shared'

import {
  UsageError,
  parseCliArgs,
  reportCollector,
  runScript,
  toFamily,
  toSourceScope,
  toWindow,
} from '../cli.ts'
import { AquasysClient } from '../sources/aquasys/client.ts'
import { fetchMeasures } from '../sources/aquasys/measures.ts'
import { listSourceIds } from '../sources/aquasys/source-ids.ts'

const SCRIPT = 'fetch:aquasys:measures'

await runScript(z.array(measureSchema), async () => {
  const args = parseCliArgs({
    from: { type: 'string' },
    to: { type: 'string' },
    family: { type: 'string', default: 'hydro' },
    station: { type: 'string', multiple: true },
    measure: { type: 'string', multiple: true },
    bbox: { type: 'string' },
  })

  const window = toWindow(args.from, args.to)
  const family = toFamily(args.family)
  const scope = toSourceScope(args.bbox, args.station)
  const quantities = selectQuantities(args.measure, family)

  const config = aquasysConfig()
  const client = new AquasysClient({ config })

  const collector = reportCollector(SCRIPT, {
    from: window.from,
    to: window.to,
    scope,
    // Aquasys widens the bounds to whole UTC days and its storage time zone is
    // not established: the assumption travels with the data.
    timeZone: config.timeZone,
    family,
    measures: quantities,
  })

  const sourceIds = await listSourceIds({ client, collector, family, scope })

  collector.progress(
    `measures of ${sourceIds.length} ${family} source(s), ${quantities.join(' and ')}, ` +
      `${window.from} → ${window.to}…`,
  )

  const { measures, density, rowsDropped } = await fetchMeasures({
    client,
    collector,
    family,
    sourceIds,
    quantities,
    window,
  })

  return {
    data: measures,
    report: collector.seal({ density, rowsDropped }),
  }
})

function selectQuantities(values: string[] | undefined, family: SourceFamily): Quantity[] {
  const collectable = dataTypesFor(family).quantities()
  if (values === undefined) return collectable

  return values.map((value) => {
    const parsed = quantitySchema.safeParse(value)
    if (!parsed.success || !collectable.includes(parsed.data)) {
      throw new UsageError(`--measure must be one of ${collectable.join(', ')} for ${family}`)
    }
    return parsed.data
  })
}
