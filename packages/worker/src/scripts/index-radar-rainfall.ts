import { z } from 'zod'

import { radarRainfallConfig, radarRainfallSeriesSchema } from '@smmarchives/shared'

import { parseCliArgs, reportCollector, runScript, toOptionalWindow } from '../cli.ts'
import { indexDeliveries } from '../sources/radar-rainfall/indexer.ts'

const SCRIPT = 'index:radar-rainfall'

await runScript(z.array(radarRainfallSeriesSchema), async () => {
  const args = parseCliArgs({
    dir: { type: 'string' },
    delivery: { type: 'string', multiple: true },
    from: { type: 'string' },
    to: { type: 'string' },
  })

  const config = radarRainfallConfig(process.env, { root: args.dir })
  const window = toOptionalWindow(args.from, args.to)

  const collector = reportCollector(SCRIPT, {
    root: config.root,
    deliveries: args.delivery ?? null,
    from: window?.from ?? null,
    to: window?.to ?? null,
  })

  collector.progress(`indexing ${config.root}…`)
  const { series, skipped } = await indexDeliveries({
    root: config.root,
    extent: config.extent,
    collector,
    deliveries: args.delivery,
    window,
  })

  return {
    data: series,
    report: collector.seal({
      // A property of the run, not of each series, and the one value the
      // document itself flags as not authoritative.
      extent: config.extent,
      entriesSkipped: skipped,
    }),
  }
})
