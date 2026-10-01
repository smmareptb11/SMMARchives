import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { rawNetworkLinkSchema } from '../src/sources/aquasys/raw.ts'
import { typeStations } from '../src/sources/aquasys/station-typing.ts'
import { fixture } from './support/fixtures.ts'

const LINKS = z.array(rawNetworkLinkSchema).parse(fixture('aquasys/network-links.json'))

describe('the category of a station', () => {
  const categories = typeStations(LINKS)

  it('is a structure on the structure network', () => {
    expect(categories.get(2)).toBe('structure')
  })

  it('is a structure on the weir and structure networks', () => {
    expect(categories.get(3)).toBe('structure')
  })

  it('is a watercourse on the low-water and flood networks', () => {
    expect(categories.get(84)).toBe('watercourse')
  })

  it('is a watercourse on the low-water network alone', () => {
    expect(categories.get(152)).toBe('watercourse')
  })

  it('is absent on a network that types nothing', () => {
    expect(categories.has(24)).toBe(false)
  })
})

describe('a weir on no other network', () => {
  it('is a structure', () => {
    const weir = LINKS.filter((link) => link.idStation === 3 && link.idNetwork === 5)

    expect(typeStations(weir).get(3)).toBe('structure')
  })
})
