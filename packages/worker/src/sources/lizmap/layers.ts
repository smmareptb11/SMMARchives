import type { ReferenceLayer, ReportCollector } from '@smmarchives/shared'

import type { LizmapClient } from './client.ts'

/**
 * The layers SMMARchives reads, all of which answer a `GetFeature`.
 *
 * `Bassins_Versants` is deliberately absent: it holds four basins with a live
 * `cumul_48h` field, an operational layer tied to SMMAR's own accumulation
 * computations, not a reference extent. The `config_*` layers are triggers for
 * SMMAR processing and are never requested.
 */
export const REFERENCE_LAYERS = [
  'ouvrage_hydraulique',
  'perimetre_smmar',
  'perimetre_syndicats',
  'bd_admin_commune',
] as const

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
