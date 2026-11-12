import { describe, expect, it } from 'vitest'

import { ngfDatumOf } from '../src/sources/aquasys/ngf-datum.ts'

describe('the NGF datum of a station, read as the Acycliq widget reads it', () => {
  it('is the altitude of the first line of the history', () => {
    expect(ngfDatumOf([{ altitude: 56.148 }])).toBe(56.148)
  })

  it('is the first line, whatever its dates or its system', () => {
    const moved = [
      { altitude: 7.285, altimetrySystem: 0, startDate: 1743458400000, endDate: 1767654000000 },
      { altitude: 4.285, altimetrySystem: 0, startDate: 1767740400000, endDate: null },
    ]

    expect(ngfDatumOf(moved)).toBe(7.285)
  })

  it('is none when the first line says zero', () => {
    expect(ngfDatumOf([{ altitude: 0 }, { altitude: 90.85 }])).toBeNull()
  })

  it('is none when the first line carries no altitude', () => {
    expect(ngfDatumOf([{}])).toBeNull()
  })

  it('is none for a station with no history', () => {
    expect(ngfDatumOf(undefined)).toBeNull()
    expect(ngfDatumOf([])).toBeNull()
  })
})
