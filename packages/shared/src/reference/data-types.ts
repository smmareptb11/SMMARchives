import type { Quantity } from '../contracts/quantity.ts'
import type { SourceFamily } from '../contracts/station.ts'

export type DataType = {
  typeId: number
  quantity: Quantity
  unit: string
}

/**
 * Maps the `typeId` of one source family to the quantities we collect.
 *
 * A `typeId` absent from the table is not decoded. That is the whole safety
 * mechanism: nothing outside the application's scope can be read by accident,
 * and an unknown identifier surfaces as a reported fallback rather than as a
 * value of the wrong nature.
 */
export class DataTypeTable {
  readonly #byTypeId: ReadonlyMap<number, DataType>
  readonly #byQuantity: ReadonlyMap<Quantity, DataType>

  constructor(entries: readonly DataType[]) {
    this.#byTypeId = new Map(entries.map((entry) => [entry.typeId, entry]))
    this.#byQuantity = new Map(entries.map((entry) => [entry.quantity, entry]))
  }

  byTypeId(typeId: number): DataType | undefined {
    return this.#byTypeId.get(typeId)
  }

  byQuantity(quantity: Quantity): DataType | undefined {
    return this.#byQuantity.get(quantity)
  }

  quantities(): Quantity[] {
    return [...this.#byQuantity.keys()]
  }
}

/**
 * The two tables are separate on purpose, and must never be merged.
 *
 * `typeId` 4 is a water level on a hydrological station and a temperature on a
 * rain gauge; `typeId` 5 is a flow and an actual evapotranspiration. A shared
 * table would ingest temperatures as water levels — a replay that reads as
 * plausible and is wrong. A `typeId` absent from a table is not decoded, which
 * is what keeps a quantity outside this application's scope out of it.
 */
export const HYDROLOGICAL_STATION_DATA_TYPES = new DataTypeTable([
  { typeId: 4, quantity: 'level', unit: 'm' },
  { typeId: 5, quantity: 'flow', unit: 'm³/s' },
])

export const RAIN_GAUGE_DATA_TYPES = new DataTypeTable([
  { typeId: 1, quantity: 'rainfall', unit: 'mm' },
])

/**
 * What a quantity is read in, whichever family measures it.
 *
 * A unit belongs to the quantity and not to the source: a screen showing a
 * value knows what it is showing, rarely which family produced it. Written out
 * rather than looked up, so that a fourth quantity added to the enum fails to
 * compile instead of showing a value with no unit beside it.
 */
export const UNITS: Record<Quantity, string> = {
  level: 'm',
  flow: 'm³/s',
  rainfall: 'mm',
}

export function dataTypesFor(family: SourceFamily): DataTypeTable {
  return family === 'hydro' ? HYDROLOGICAL_STATION_DATA_TYPES : RAIN_GAUGE_DATA_TYPES
}
