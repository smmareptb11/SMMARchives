import type { RawAltimetry } from './raw.ts'

/**
 * The NGF altitude of a station's gauge zero, read as the Acycliq widget reads
 * it: the first line of its altimetric history, when that altitude is above zero.
 *
 * The widget's rule on purpose, so that both show a station in the same metres
 * NGF: the dates of a line and its system are not read.
 */
export function ngfDatumOf(lines: readonly RawAltimetry[] | undefined): number | null {
  const altitude = lines?.[0]?.altitude

  return altitude !== undefined && altitude > 0 ? altitude : null
}
