import { z } from 'zod'

import { aquasysConfig, thresholdSchema } from '@smmarchives/shared'

import { parseCliArgs, reportCollector, runScript, toFamily, toSourceScope } from '../cli.ts'
import { AquasysClient } from '../sources/aquasys/client.ts'
import { listSourceIds } from '../sources/aquasys/source-ids.ts'
import { fetchThresholds } from '../sources/aquasys/thresholds.ts'

const SCRIPT = 'fetch:aquasys:thresholds'

await runScript(z.array(thresholdSchema), async () => {
  const args = parseCliArgs({
    family: { type: 'string', default: 'hydro' },
    station: { type: 'string', multiple: true },
    bbox: { type: 'string' },
  })

  const family = toFamily(args.family)
  const scope = toSourceScope(args.bbox, args.station)
  const client = new AquasysClient({ config: aquasysConfig() })
  const collector = reportCollector(SCRIPT, { family, scope })

  const sourceIds = await listSourceIds({ client, collector, family, scope })
  collector.progress(`thresholds of ${sourceIds.length} ${family} source(s)…`)

  const thresholds = await fetchThresholds({ client, collector, family, sourceIds })

  return {
    data: thresholds,
    report: collector.seal(),
  }
})
