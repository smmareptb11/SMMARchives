import { describe, expect, it } from 'vitest'

import { exportName, mapExportName, placeLegend, slugify } from '../src/download.ts'

describe('a part of an image name', () => {
  it('drops accents and turns anything else into a dash', () => {
    expect(slugify('Ruisseau de la Nère à Villefranche')).toBe('ruisseau-de-la-nere-a-villefranche')
  })

  it('keeps no dash at either end', () => {
    expect(slugify(' « Crue » ')).toBe('crue')
  })

  it('is cut short, and never on a dash', () => {
    const cut = slugify(`${'a'.repeat(59)} b`)

    expect(cut).toBe('a'.repeat(59))
  })

  it('is empty for nothing', () => {
    expect([slugify(null), slugify(undefined), slugify('')]).toEqual(['', '', ''])
  })
})

describe('the name an image is saved under', () => {
  it('names the quantity, the source and its identifier', () => {
    expect(exportName(['débit', 'Trèbes', 84])).toBe('smmarchives-debit-trebes-84.png')
  })

  it('leaves out a part that says nothing', () => {
    expect(exportName(['carte', null, '2019-10-22'])).toBe('smmarchives-carte-2019-10-22.png')
  })
})

describe('the name of an image of the map', () => {
  it('names the replay and the instant read, in French time', () => {
    const at = Date.parse('2019-10-22T12:00:00Z')

    expect(mapExportName("Crue de l'Aude, octobre 2019", at)).toBe(
      'smmarchives-carte-crue-de-l-aude-octobre-2019-2019-10-22-14h00.png',
    )
  })

  it('names the instant alone for a replay without a title', () => {
    const at = Date.parse('2019-12-22T12:30:00Z')

    expect(mapExportName(null, at)).toBe('smmarchives-carte-2019-12-22-13h30.png')
  })
})

describe('the legend under the image of a chart', () => {
  it('holds every entry on one row, centred, when the room allows', () => {
    expect(placeLegend([40, 60], 200, 10)).toEqual([
      { row: 0, x: 45 },
      { row: 0, x: 95 },
    ])
  })

  it('starts a new row where the next entry would not fit', () => {
    expect(placeLegend([80, 80, 80], 200, 10).map((one) => one.row)).toEqual([0, 0, 1])
  })

  it('gives an entry wider than the room a row of its own, from the left', () => {
    expect(placeLegend([30, 300, 30], 200, 10)).toEqual([
      { row: 0, x: 85 },
      { row: 1, x: 0 },
      { row: 2, x: 85 },
    ])
  })

  it('takes no row for no entry', () => {
    expect(placeLegend([], 200, 10)).toEqual([])
  })
})
