import type { RawAltimetry } from './raw.ts'

/**
 * The NGF altitude of a station's gauge zero, read as the Acycliq widget reads
 * it so that both show the same metres NGF: the first line of its altimetric
 * history, when above zero, whatever its dates and system.
 */
export function ngfDatumOf(lines: readonly RawAltimetry[] | undefined): number | null {
  const altitude = lines?.[0]?.altitude

  return altitude !== undefined && altitude > 0 ? altitude : null
}
