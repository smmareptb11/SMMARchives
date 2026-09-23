import { z } from 'zod'

import { lizmapConfig, webcamImageSchema } from '@smmarchives/shared'

import { parseCliArgs, reportCollector, runScript, toExtent, toOptionalWindow } from '../cli.ts'
import { RETENTION_DAYS, fetchWebcamImages } from '../sources/ceneau/images.ts'
import { LizmapClient } from '../sources/lizmap/client.ts'

const SCRIPT = 'fetch:webcams:images'

await runScript(z.array(webcamImageSchema), async () => {
  const args = parseCliArgs({
    code: { type: 'string', multiple: true },
    from: { type: 'string' },
    to: { type: 'string' },
    bbox: { type: 'string' },
  })

  const window = toOptionalWindow(args.from, args.to)
  const extent = toExtent(args.bbox)
  const client = new LizmapClient({ config: lizmapConfig() })
  const collector = reportCollector(SCRIPT, {
    from: window?.from ?? null,
    to: window?.to ?? null,
    extent: extent ?? null,
  })

  const { images, beyondRetention } = await fetchWebcamImages({
    client,
    collector,
    codes: args.code,
    extent,
    window,
  })
  if (beyondRetention) {
    collector.progress(
      `  the window predates Ceneau's ${RETENTION_DAYS}-day retention: no image can exist`,
    )
  }

  return {
    data: images,
    report: collector.seal({ beyondRetention }),
  }
})
