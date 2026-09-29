import type { Fallback } from '../envelope.ts'
import type { StationCategory } from '../contracts/station.ts'

/**
 * How a station is rendered, obtained once from the SMMAR crisis Lizmap.
 *
 * Frozen reference data. Establishing it costs 94 `GetFeatureInfo` requests on
 * a production crisis tool, so it is not re-derived on every generation; it is
 * replayed only when the station fleet changes.
 */
const CATEGORIES: ReadonlyArray<[StationCategory, ReadonlyArray<number | [number, number]>]> = [
  [
    'watercourse',
    [
      1,
      [9, 20],
      22,
      23,
      [29, 33],
      [35, 37],
      [42, 44],
      [46, 58],
      [61, 75],
      77,
      79,
      [83, 86],
      151,
      160,
    ],
  ],
  ['structure', [[2, 8], 21, 34, [38, 41], 45, 59, 60, 80, 81, 82, 159]],
]

/**
 * Stations present in Aquasys but in no Lizmap layer.
 *
 * Listed rather than left to the unknown-station path so the two situations are
 * distinguishable in the report: these are known to be untyped, a station
 * outside both sets is new.
 */
const UNTYPED_IN_LIZMAP = new Set([152, 153, 154, 155, 156, 157, 158])

/**
 * Stations Aquasys holds that bear on no flood, and that a replay never holds.
 *
 * Aquasys states nothing that sets them apart, hence a list.
 */
const OUT_OF_SCOPE = new Set(rangeOf(24, 28))

export function isOutOfScope(id: number): boolean {
  return OUT_OF_SCOPE.has(id)
}

const TYPING = new Map<number, StationCategory>(
  CATEGORIES.flatMap(([category, ranges]) =>
    ranges.flatMap((range): Array<[number, StationCategory]> =>
      typeof range === 'number'
        ? [[range, category]]
        : rangeOf(range[0], range[1]).map((id) => [id, category]),
    ),
  ),
)

/** The category the map falls back to. */
const DEFAULT_CATEGORY: StationCategory = 'watercourse'

export type StationTyping = {
  category: StationCategory
  fallback: Fallback | undefined
}

/** Types a station, reporting rather than hiding the cases it cannot decide. */
export function typeStation(id: number): StationTyping {
  const category = TYPING.get(id)
  if (category !== undefined) return { category, fallback: undefined }

  return {
    category: DEFAULT_CATEGORY,
    fallback: {
      subject: `station ${id}`,
      rule: UNTYPED_IN_LIZMAP.has(id)
        ? 'station appears in no Lizmap layer'
        : 'station absent from the frozen typing table',
      applied: DEFAULT_CATEGORY,
    },
  }
}

function rangeOf(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset)
}
