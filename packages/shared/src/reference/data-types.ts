import type { Quantity } from '../contracts/quantity.ts'
import type { SourceFamily } from '../contracts/station.ts'

export type DataType = {
  typeId: number
  quantity: Quantity
  unit: string
}

/**
 * Maps the `typeId` of one source family to the quantities we collect. A
 * `typeId` absent from the table is not decoded: it surfaces as a reported
 * fallback rather than as a value of the wrong nature.
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
 * The two tables are separate on purpose, and must never be merged: `typeId` 4
 * is a water level on a hydrological station and a temperature on a rain gauge,
 * `typeId` 5 a flow and an actual evapotranspiration.
 */
export const HYDROLOGICAL_STATION_DATA_TYPES = new DataTypeTable([
  { typeId: 4, quantity: 'level', unit: 'm' },
  { typeId: 5, quantity: 'flow', unit: 'm³/s' },
])

export const RAIN_GAUGE_DATA_TYPES = new DataTypeTable([
  { typeId: 1, quantity: 'rainfall', unit: 'mm' },
])

/**
 * What a quantity is read in, whichever family measures it. Written out rather
 * than looked up, so that a quantity added to the enum fails to compile instead
 * of showing a value with no unit.
 */
export const UNITS: Record<Quantity, string> = {
  level: 'm',
  flow: 'm³/s',
  rainfall: 'mm',
}

export function dataTypesFor(family: SourceFamily): DataTypeTable {
  return family === 'hydro' ? HYDROLOGICAL_STATION_DATA_TYPES : RAIN_GAUGE_DATA_TYPES
}
