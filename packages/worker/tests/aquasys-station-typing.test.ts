import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { rawNetworkLinkSchema } from '../src/sources/aquasys/raw.ts'
import { typeStations } from '../src/sources/aquasys/station-typing.ts'
import { fixture } from './support/fixtures.ts'

const LINKS = z.array(rawNetworkLinkSchema).parse(fixture('aquasys/network-links.json'))

describe('the category of a station', () => {
  const { categories, fallbacks } = typeStations(LINKS)

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

  it('is read from the recorded links without a fallback', () => {
    expect(fallbacks).toEqual([])
  })
})

describe('a weir on no other network', () => {
  it('is a structure', () => {
    const weir = LINKS.filter((link) => link.idStation === 3 && link.idNetwork === 5)

    expect(typeStations(weir).categories.get(3)).toBe('structure')
  })
})

describe('a station its networks type both ways', () => {
  const contradicting = [...LINKS, { idStation: 84, idNetwork: 4 }]

  it('is left untyped', () => {
    expect(typeStations(contradicting).categories.has(84)).toBe(false)
  })

  it('is reported', () => {
    expect(typeStations(contradicting).fallbacks).toEqual([
      {
        subject: 'station 84',
        rule: 'on both structure and watercourse networks',
        applied: 'station dropped',
      },
    ])
  })

  it('is judged the same whatever the order of its links', () => {
    expect(typeStations([...contradicting].reverse())).toEqual(typeStations(contradicting))
  })

  it('is reported in station order alongside another, whatever the order of their links', () => {
    const both = [...contradicting, { idStation: 2, idNetwork: 2 }]
    const subjects = (links: typeof both) =>
      typeStations(links).fallbacks.map((fallback) => fallback.subject)

    expect(subjects(both)).toEqual(['station 2', 'station 84'])
    expect(subjects([...both].reverse())).toEqual(['station 2', 'station 84'])
  })

  it('leaves the other stations typed', () => {
    const { categories } = typeStations(contradicting)

    expect(categories.get(2)).toBe('structure')
    expect(categories.get(152)).toBe('watercourse')
  })
})
