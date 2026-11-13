import { setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

/*
 * MapLibre finds its worker by a name it builds at run time, which a bundle
 * cannot see: in production no tile would ever be drawn. Named here, the worker
 * is bundled, before any map is built.
 */
setWorkerUrl(workerUrl)

/** The one thing a replay does not freeze, served by OpenFreeMap without a key or an account. */
const BASEMAP = 'https://tiles.openfreemap.org/styles/positron'

/** Ground for a map whose basemap never came: no source, so nothing to fetch. */
export const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [] }

/** How long the basemap is waited for before the map is opened without it. */
const GROUND_TIMEOUT = 8_000

/**
 * The basemap, or blank ground when it cannot be had, fetched before the map is
 * built so that a reader is told it is missing first. The style names its
 * sprite, fonts and tiles by absolute address, so the object reads as its
 * address would.
 */
export async function groundOf(): Promise<string | StyleSpecification> {
  try {
    const response = await fetch(BASEMAP, { signal: AbortSignal.timeout(GROUND_TIMEOUT) })
    return response.ok ? ((await response.json()) as StyleSpecification) : BLANK
  } catch {
    return BLANK
  }
}
