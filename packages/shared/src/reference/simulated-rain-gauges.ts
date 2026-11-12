/**
 * The codes Aquasys gives the rain gauges it simulates, which are grid cells of
 * a reanalysis and not instruments: `SAFRAN_6120_18010` for SAFRAN,
 * `X2.25Y43` for ERA5.
 *
 * Read off the codes because no field says it. Provisional: the rule awaits
 * the SMMAR's word on how a simulated gauge is meant to be recognised.
 */
const SIMULATED_CODES: readonly RegExp[] = [/^SAFRAN_/, /^X\d+(?:\.\d+)?Y\d+(?:\.\d+)?$/]

export function isSimulatedRainGauge(code: string): boolean {
  return SIMULATED_CODES.some((one) => one.test(code))
}
