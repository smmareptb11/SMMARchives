import { describe, expect, it } from 'vitest'

import { measuredFor, type Held } from '../src/detail/measured.ts'

const level: Held = {
  replayId: 'r',
  sourceId: 4,
  quantity: 'level',
  series: { quantity: 'level', unit: 'm', points: [] },
  failure: undefined,
}

const reading = { series: undefined, failure: undefined }

describe('what a station window is handed of its measures', () => {
  it('is what was read, when it is what is asked for', () => {
    expect(measuredFor(level, { replayId: 'r', sourceId: 4, quantity: 'level' })).toEqual({
      series: level.series,
      failure: undefined,
    })
  })

  /** The level, for one frame, under the button that says flow. */
  it('is being read the moment another quantity is asked for', () => {
    expect(measuredFor(level, { replayId: 'r', sourceId: 4, quantity: 'flow' })).toEqual(reading)
  })

  it('is being read for another source or another replay', () => {
    expect(measuredFor(level, { replayId: 'r', sourceId: 7, quantity: 'level' })).toEqual(reading)
    expect(measuredFor(level, { replayId: 's', sourceId: 4, quantity: 'level' })).toEqual(reading)
  })

  it('is being read before anything came back', () => {
    expect(measuredFor(undefined, { replayId: 'r', sourceId: 4, quantity: 'level' })).toEqual(
      reading,
    )
  })

  it('carries a failure, for what failed to be read', () => {
    const failed: Held = { ...level, series: undefined, failure: 'Lecture impossible.' }

    expect(measuredFor(failed, { replayId: 'r', sourceId: 4, quantity: 'level' })).toEqual({
      series: undefined,
      failure: 'Lecture impossible.',
    })
  })
})
