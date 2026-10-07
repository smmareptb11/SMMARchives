import type { StyleSpecification } from 'maplibre-gl'

/**
 * The one thing a replay does not freeze.
 *
 * OpenFreeMap serves this style without a key, so no account, quota or
 * proprietary dependency stands between a reader and the map.
 */
const BASEMAP = 'https://tiles.openfreemap.org/styles/positron'

/** Ground for a map whose basemap never came: no source, so nothing to fetch. */
export const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [] }

/** How long the basemap is waited for before the map is opened without it. */
const GROUND_TIMEOUT = 8_000

/**
 * The basemap, or blank ground when it cannot be had.
 *
 * Fetched before the map is built: the ground is an input, so a reader is told
 * it is missing before anything is drawn.
 *
 * The style names its sprite, its fonts and its tiles by absolute address, so
 * handing MapLibre the object rather than the address changes nothing it reads.
 */
export async function groundOf(): Promise<string | StyleSpecification> {
  try {
    const response = await fetch(BASEMAP, { signal: AbortSignal.timeout(GROUND_TIMEOUT) })
    return response.ok ? ((await response.json()) as StyleSpecification) : BLANK
  } catch {
    return BLANK
  }
}
