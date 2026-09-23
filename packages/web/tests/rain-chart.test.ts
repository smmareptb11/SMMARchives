import { describe, expect, it } from 'vitest'

import { NONE, readAt, statesAt } from '../src/detail/rain-chart.ts'
import type { Step } from '../src/rain.ts'
import { at } from './support/content.ts'

const steps: Step[] = [
  { from: at('2019-10-22T05:00:00.000Z'), at: at('2019-10-22T06:00:00.000Z'), millimetres: 3 },
  { from: at('2019-10-22T06:00:00.000Z'), at: at('2019-10-22T07:00:00.000Z'), millimetres: 0 },
  { from: at('2019-10-22T07:00:00.000Z'), at: at('2019-10-22T08:00:00.000Z'), millimetres: 9 },
]

describe('the bar the reading is standing on', () => {
  it('is the last measure taken at or before the cursor', () => {
    expect(statesAt(steps, at('2019-10-22T07:30:00.000Z'))).toEqual(['past', 'read', 'ahead'])
  })

  /**
   * The same measure `rainAt` counts the total up to, so the figure in the
   * header and the bar picked out under it are never two different measures.
   */
  it('is the measure itself on the instant it was taken', () => {
    expect(statesAt(steps, at('2019-10-22T07:00:00.000Z'))).toEqual(['past', 'read', 'ahead'])
  })

  it('stands on none before the gauge first looked', () => {
    expect(statesAt(steps, at('2019-10-22T00:00:00.000Z'))).toEqual(['ahead', 'ahead', 'ahead'])
  })

  it('stands on the last one once the period is over', () => {
    expect(statesAt(steps, at('2019-10-22T23:00:00.000Z'))).toEqual(['past', 'past', 'read'])
  })
})

describe('the rank of the bar the reading stands on', () => {
  it('is nothing at all before the gauge first looked', () => {
    expect(readAt(steps, at('2019-10-22T00:00:00.000Z'))).toBe(NONE)
  })

  it('is the rank `statesAt` marks as read', () => {
    const rank = readAt(steps, at('2019-10-22T07:30:00.000Z'))

    expect(statesAt(steps, at('2019-10-22T07:30:00.000Z'))[rank]).toBe('read')
  })
})
