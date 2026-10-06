import type { ReferenceLayer, ReportCollector } from '@smmarchives/shared'

import type { LizmapClient } from './client.ts'

/**
 * The layers SMMARchives reads, all of which answer a `GetFeature`.
 *
 * The perimeters of the basin and of its unions are absent: they change rarely,
 * and the application carries them frozen in `shared/src/reference/`.
 * `Bassins_Versants` is deliberately absent too: it holds four basins with a
 * live `cumul_48h` field, an operational layer tied to SMMAR's own accumulation
 * computations, not a reference extent. The `config_*` layers are triggers for
 * SMMAR processing and are never requested.
 */
export const REFERENCE_LAYERS = ['ouvrage_hydraulique'] as const

export type FetchLayersOptions = {
  client: LizmapClient
  collector: ReportCollector
  layers: readonly string[]
}

export async function fetchReferenceLayers(options: FetchLayersOptions): Promise<ReferenceLayer[]> {
  const layers: ReferenceLayer[] = []

  for (const name of options.layers) {
    options.collector.progress(`  layer ${name}…`)
    try {
      const geojson = await options.client.getFeature(name)
      if (geojson.features.length === 0) options.collector.withoutData(name)
      layers.push({ name, featureCount: geojson.features.length, geojson })
    } catch (error) {
      options.collector.failed(`layer ${name}`, error)
    }
  }

  return layers
}
