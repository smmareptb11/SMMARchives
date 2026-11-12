import type { LevelDatum } from '../contracts/station.ts'

/**
 * The Aquasys stations whose level is stored in metres NGF rather than from
 * their gauge zero, by identifier.
 *
 * Nothing the source returns says so: their altimetric history, landmarks and
 * measurement points read the same as those of a station measured from its
 * gauge zero. Their measures and thresholds do — they sit around the NGF
 * altitude of the gauge zero, where the rest of the fleet sits around zero.
 *
 * Read off the measures of every episode replayed, 2018 to 2026, and not of one:
 * a station with no measure over an episode says nothing of its datum there.
 * Every station whose level never falls under two metres is one of these, and
 * none other is. Eleven of them give no NGF altitude of their gauge zero, so
 * their level reads in metres NGF and in nothing else.
 */
const MEASURED_IN_NGF: ReadonlySet<number> = new Set([
  2, 3, 4, 5, 6, 7, 8, 21, 38, 39, 40, 41, 45, 59, 60, 81, 82,
])

export function levelDatumOf(stationId: number): LevelDatum {
  return MEASURED_IN_NGF.has(stationId) ? 'ngf' : 'gauge'
}
