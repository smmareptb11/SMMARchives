import { describe, expect, it } from 'vitest'

import { lanesOf, type ReplayContent } from '../src/tracks/lanes.ts'
import { aCamera, aGauge, aSeries, aStation, held, shown } from './support/content.ts'

describe('the order of the lanes in a family', () => {
  const labelsOf = (content: ReplayContent, family: string) =>
    shown(lanesOf(content), family)?.lanes.map((one) => one.label)

  it('puts the stations in the order of their names, whatever order they came in', () => {
    const stations = [
      aStation(1, 'Trèbes'),
      aStation(2, 'écluse de Fresquel'),
      aStation(3, 'Carcassonne'),
      aStation(4, 'Ecluse de Marseillette'),
      aStation(5, 'Digue de Cuxac', 'structure'),
      aStation(6, 'Barrage de Jouarres', 'structure'),
    ]

    expect(labelsOf(held({ stations }), 'watercourse')).toEqual([
      'Carcassonne',
      'écluse de Fresquel',
      'Ecluse de Marseillette',
      'Trèbes',
    ])
    expect(labelsOf(held({ stations }), 'structure')).toEqual([
      'Barrage de Jouarres',
      'Digue de Cuxac',
    ])
  })

  /** A name can open on a bracket, as « [Chenal de Coursan] à Coursan » does. */
  it('reads a name past its brackets', () => {
    const stations = [
      aStation(1, 'Digue de Cuxac', 'structure'),
      aStation(2, '[Chenal de Coursan] à Coursan', 'structure'),
      aStation(3, 'Barrage de Jouarres', 'structure'),
    ]

    expect(labelsOf(held({ stations }), 'structure')).toEqual([
      'Barrage de Jouarres',
      '[Chenal de Coursan] à Coursan',
      'Digue de Cuxac',
    ])
  })

  it('reads the numbers in a name as numbers', () => {
    const stations = [aStation(1, 'Seuil 10'), aStation(2, 'Seuil 9')]

    expect(labelsOf(held({ stations }), 'watercourse')).toEqual(['Seuil 9', 'Seuil 10'])
  })

  it('puts the rain gauges in the order of their names', () => {
    const rainGauges = [
      aGauge(9, 'Villegly', 2.4),
      aGauge(4, 'Couiza', 2.2),
      aGauge(7, 'Alzonne', 2.1),
    ]

    expect(labelsOf(held({ rainGauges, rain: new Map() }), 'rain-gauge')).toEqual([
      'Alzonne',
      'Couiza',
      'Villegly',
    ])
  })

  /** The lane says the town, so the town is what a reader looks a camera up by. */
  it('puts the cameras in the order of their towns, and two of one town in the order of their codes', () => {
    const webcams = [
      aCamera('101', 'Trèbes'),
      aCamera('215', 'Mailhac'),
      aCamera('308', 'Cuxac-d’Aude'),
      aCamera('099', 'Trèbes'),
    ]
    const lanes = shown(lanesOf(held({ webcams, images: [] })), 'webcam')?.lanes

    expect(lanes?.map((one) => one.id)).toEqual([
      'webcam-308',
      'webcam-215',
      'webcam-099',
      'webcam-101',
    ])
  })

  /** By name, `pluvio12h` would come before `pluvio1h`, and `pluvio5mn` among the hours. */
  it('keeps the radar rainfall products in the order of their delivery', () => {
    const series = ['pluvio1h', 'pluvio12h', 'pluvio5mn'].map((product) => aSeries({ product }))

    expect(labelsOf(held({ series }), 'radar')).toEqual(['pluvio1h', 'pluvio12h', 'pluvio5mn'])
  })
})
