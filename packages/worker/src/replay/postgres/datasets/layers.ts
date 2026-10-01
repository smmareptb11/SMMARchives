import { referenceLayerSchema, type ReferenceLayer } from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'

/**
 * A reference layer, one row per feature rather than one document.
 *
 * It is what lets an outline be simplified when it is served rather than once
 * and for all at import: what a map needs of it depends on the zoom it is
 * drawn at.
 */
export async function writeLayers(db: Queryable, replayId: string, data: unknown): Promise<void> {
  const layers = data as ReferenceLayer[]
  await db.query('delete from reference_feature where replay_id = $1', [replayId])

  for (const layer of layers) {
    let ordinal = 0
    for (const feature of layer.geojson.features) {
      await db.query(
        `insert into reference_feature (replay_id, layer, ordinal, properties, geom)
         values ($1, $2, $3, $4::jsonb,
                 case when $5::text is null then null
                      else ST_SetSRID(ST_GeomFromGeoJSON($5), 4326) end)`,
        [
          replayId,
          layer.name,
          ordinal,
          JSON.stringify(feature.properties ?? {}),
          feature.geometry === null ? null : JSON.stringify(feature.geometry),
        ],
      )
      ordinal += 1
    }
    // A layer that came back empty is still a layer the replay holds, and
    // nothing but its own row would say so.
    if (layer.geojson.features.length === 0) {
      await db.query(
        `insert into reference_feature (replay_id, layer, ordinal, properties, geom)
         values ($1, $2, -1, '{}'::jsonb, null)`,
        [replayId, layer.name],
      )
    }
  }
}

/**
 * How far a served outline may stray from the one that was collected, in degrees.
 *
 * Fifty metres, against a map that opens at a zoom where one pixel is about a
 * hundred and seventy, where the nine decimals PostGIS serialises by default
 * carry a tenth of a millimetre. Topology is preserved, so an outline never
 * crosses itself on the way.
 */
const SIMPLIFIED_TO = 0.0005

export async function readLayers(
  db: Queryable,
  replayId: string,
  name?: string,
): Promise<ReferenceLayer[]> {
  const rows = (
    await db.query<{
      layer: string
      ordinal: number
      properties: Record<string, unknown>
      geometry: string | null
    }>(
      `select layer, ordinal, properties,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $3), 5) as geometry
         from reference_feature
        where replay_id = $1 and ($2::text is null or layer = $2)
        order by layer, ordinal`,
      [replayId, name ?? null, SIMPLIFIED_TO],
    )
  ).rows

  const byLayer = new Map<string, unknown[]>()
  for (const row of rows) {
    const features = byLayer.get(row.layer) ?? []
    // The placeholder an empty layer was stored as carries no feature.
    if (row.ordinal >= 0) {
      features.push({
        type: 'Feature',
        properties: row.properties,
        geometry: row.geometry === null ? null : (JSON.parse(row.geometry) as unknown),
      })
    }
    byLayer.set(row.layer, features)
  }

  return [...byLayer].map(([layer, features]) =>
    referenceLayerSchema.parse({
      name: layer,
      featureCount: features.length,
      geojson: { type: 'FeatureCollection', features },
    }),
  )
}
