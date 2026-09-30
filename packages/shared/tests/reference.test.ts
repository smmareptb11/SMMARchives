import { describe, expect, it } from 'vitest'

import {
  HYDROLOGICAL_STATION_DATA_TYPES,
  RAIN_GAUGE_DATA_TYPES,
  UNITS,
} from '../src/reference/data-types.ts'

describe('the two data type tables', () => {
  it('read the same typeId as two different things, or as nothing', () => {
    expect(HYDROLOGICAL_STATION_DATA_TYPES.byTypeId(4)?.quantity).toBe('level')
    expect(HYDROLOGICAL_STATION_DATA_TYPES.byTypeId(5)?.quantity).toBe('flow')

    // On a rain gauge those identifiers are a temperature and an
    // evapotranspiration, neither of which the application collects.
    expect(RAIN_GAUGE_DATA_TYPES.byTypeId(4)).toBeUndefined()
    expect(RAIN_GAUGE_DATA_TYPES.byTypeId(5)).toBeUndefined()
  })

  it('holds only what the application replays', () => {
    expect(HYDROLOGICAL_STATION_DATA_TYPES.quantities()).toEqual(['level', 'flow'])
    expect(RAIN_GAUGE_DATA_TYPES.quantities()).toEqual(['rainfall'])
  })

  it('has no rainfall on a hydrological station', () => {
    expect(HYDROLOGICAL_STATION_DATA_TYPES.byQuantity('rainfall')).toBeUndefined()
  })
})

describe('the unit a quantity is read in', () => {
  /** The tables decode with it; a screen writes it beside a value. */
  it('is one per quantity, and the same one the collectors read', () => {
    expect(UNITS.level).toBe(HYDROLOGICAL_STATION_DATA_TYPES.byQuantity('level')?.unit)
    expect(UNITS.flow).toBe('m³/s')
    expect(UNITS.rainfall).toBe(RAIN_GAUGE_DATA_TYPES.byQuantity('rainfall')?.unit)
  })
})
