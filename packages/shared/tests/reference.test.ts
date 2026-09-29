import { describe, expect, it } from 'vitest'

import {
  HYDROLOGICAL_STATION_DATA_TYPES,
  RAIN_GAUGE_DATA_TYPES,
  UNITS,
} from '../src/reference/data-types.ts'
import { isExcludedStation, typeStation } from '../src/reference/station-typing.ts'

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

describe('station typing', () => {
  const count = (category: string) =>
    Array.from({ length: 160 }, (_, index) => index + 1).filter(
      (id) => !typeStation(id).fallback && typeStation(id).category === category,
    ).length

  it('matches the fleet read from the Lizmap: 62 watercourse, 20 structure', () => {
    expect(count('watercourse')).toBe(62)
    expect(count('structure')).toBe(20)
  })

  it('excludes the five karst stations, and only them', () => {
    const excluded = Array.from({ length: 160 }, (_, index) => index + 1).filter(isExcludedStation)
    expect(excluded).toEqual([24, 25, 26, 27, 28])
  })

  it('types a station read from the Lizmap without a fallback', () => {
    expect(typeStation(84)).toEqual({ category: 'watercourse', fallback: undefined })
    expect(typeStation(2).category).toBe('structure')
  })

  it('signals rather than hides a station that appears in no Lizmap layer', () => {
    const typing = typeStation(152)
    expect(typing.category).toBe('watercourse')
    expect(typing.fallback).toEqual({
      subject: 'station 152',
      rule: 'station appears in no Lizmap layer',
      applied: 'watercourse',
    })
  })

  it('tells a new station apart from a known untyped one', () => {
    expect(typeStation(9999).fallback?.rule).toBe('station absent from the frozen typing table')
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
