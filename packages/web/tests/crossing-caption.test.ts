import { describe, expect, it } from 'vitest'

import { crossingCaption } from '../src/tracks/crossing.ts'
import { lanesOf } from '../src/tracks/lanes.ts'
import { aCrossing, aStation, aThreshold, held, shown } from './support/content.ts'

/** As the replay titles it: the station, then the threshold. */
const crossed = (threshold = aThreshold(), to: string | null = '2019-10-22T12:00:00.000Z') =>
  aCrossing({
    sourceId: 84,
    title: 'Trèbes — Vigilance',
    from: '2019-10-22T06:00:00.000Z',
    to,
    crossing: threshold,
  })

describe('what a crossing says of itself on its lane', () => {
  it('says the threshold, when it was reached and when the measure fell back under it', () => {
    expect(crossingCaption(crossed())).toBe(
      'Seuil « Vigilance » atteint le 22/10/2019 08:00 ; repassé en dessous le 22/10/2019 14:00.',
    )
  })

  /** The lane already says the station, at its left. */
  it('does not name the station again', () => {
    expect(crossingCaption(crossed())).not.toContain('Trèbes')
  })

  /** Its end is then the last measure, not a fall the source never reported. */
  it('says a crossing that never fell back is still on at the last measure', () => {
    expect(crossingCaption(crossed(aThreshold({ stillActiveAtEnd: true })))).toBe(
      'Seuil « Vigilance » atteint le 22/10/2019 08:00 ; toujours atteint à la dernière mesure, le 22/10/2019 14:00.',
    )
  })

  it('says only when it was reached, for a crossing with no end', () => {
    expect(crossingCaption(crossed(aThreshold(), null))).toBe(
      'Seuil « Vigilance » atteint le 22/10/2019 08:00.',
    )
  })

  it('says last that the type of its threshold was deduced', () => {
    expect(crossingCaption(crossed(aThreshold({ natureIsFallback: true })))).toBe(
      'Seuil « Vigilance » atteint le 22/10/2019 08:00 ; repassé en dessous le 22/10/2019 14:00. ' +
        'La source ne précise pas si ce seuil est une alerte de crue, un seuil de sécheresse ou un repère de crue : ce type a été déduit.',
    )
  })

  it('is what the mark of the crossing says, whole', () => {
    const content = held({ stations: [aStation(84, 'Trèbes')], events: [crossed()] })
    const mark = shown(lanesOf(content), 'watercourse')?.lanes[0]?.marks[0]

    expect(mark?.caption).toBe(crossingCaption(crossed()))
  })
})
