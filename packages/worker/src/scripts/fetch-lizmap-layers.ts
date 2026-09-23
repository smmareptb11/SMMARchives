import { z } from 'zod'

import { lizmapConfig, referenceLayerSchema } from '@smmarchives/shared'

import { UsageError, parseCliArgs, reportCollector, runScript } from '../cli.ts'
import { LizmapClient } from '../sources/lizmap/client.ts'
import { REFERENCE_LAYERS, fetchReferenceLayers } from '../sources/lizmap/layers.ts'

const SCRIPT = 'fetch:lizmap:layers'

await runScript(z.array(referenceLayerSchema), async () => {
  const args = parseCliArgs({ layer: { type: 'string', multiple: true } })

  const layers = selectLayers(args.layer)
  const collector = reportCollector(SCRIPT, { layers })

  collector.progress(`reference layers: ${layers.join(', ')}…`)
  const data = await fetchReferenceLayers({
    client: new LizmapClient({ config: lizmapConfig() }),
    collector,
    layers,
  })

  return {
    data,
    report: collector.seal(),
  }
})

function selectLayers(requested: string[] | undefined): string[] {
  if (requested === undefined) return [...REFERENCE_LAYERS]

  const unknown = requested.filter((name) => !REFERENCE_LAYERS.includes(name as never))
  if (unknown.length > 0) {
    throw new UsageError(
      `--layer must be one of ${REFERENCE_LAYERS.join(', ')}; got ${unknown.join(', ')}`,
    )
  }
  return requested
}
