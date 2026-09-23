import { z } from 'zod'

import { lizmapConfig, webcamSchema } from '@smmarchives/shared'

import { parseCliArgs, reportCollector, runScript, toExtent } from '../cli.ts'
import { EXPLOITABLE_SOURCE, fetchWebcamPositions } from '../sources/ceneau/webcams.ts'
import { LizmapClient } from '../sources/lizmap/client.ts'

const SCRIPT = 'fetch:webcams:positions'

await runScript(z.array(webcamSchema), async () => {
  const args = parseCliArgs({ bbox: { type: 'string' } })
  const extent = toExtent(args.bbox)

  const collector = reportCollector(SCRIPT, { source: EXPLOITABLE_SOURCE, extent: extent ?? null })
  collector.progress('webcam positions…')

  const data = await fetchWebcamPositions({
    client: new LizmapClient({ config: lizmapConfig() }),
    collector,
    extent,
  })

  return {
    data,
    report: collector.seal(),
  }
})
