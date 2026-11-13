import type { LevelDatum } from '../contracts/station.ts'

/**
 * The Aquasys stations whose level is stored in metres NGF rather than from
 * their gauge zero, by identifier.
 *
 * No field of the source says so; their measures and thresholds do, sitting
 * around the NGF altitude of the gauge zero where the rest of the fleet sits
 * around zero. Read off every episode replayed, 2018 to 2026: every station
 * whose level never falls under two metres is one of these, and none other is.
 */
const MEASURED_IN_NGF: ReadonlySet<number> = new Set([
  2, 3, 4, 5, 6, 7, 8, 21, 38, 39, 40, 41, 45, 59, 60, 81, 82,
])

export function levelDatumOf(stationId: number): LevelDatum {
  return MEASURED_IN_NGF.has(stationId) ? 'ngf' : 'gauge'
}
