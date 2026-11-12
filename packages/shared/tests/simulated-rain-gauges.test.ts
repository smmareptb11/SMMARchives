import { describe, expect, it } from 'vitest'

import { isSimulatedRainGauge } from '../src/reference/simulated-rain-gauges.ts'

describe('a simulated rain gauge, read off its code', () => {
  it('is a SAFRAN cell or an ERA5 one', () => {
    expect(isSimulatedRainGauge('SAFRAN_6120_18010')).toBe(true)
    expect(isSimulatedRainGauge('X2.25Y43')).toBe(true)
    expect(isSimulatedRainGauge('X2.75Y43.25')).toBe(true)
  })

  it('is never an instrument, whatever its code looks like', () => {
    expect(isSimulatedRainGauge('11069001')).toBe(false)
    expect(isSimulatedRainGauge('PL8999')).toBe(false)
    expect(isSimulatedRainGauge('C4500_PL1_V1')).toBe(false)
    expect(isSimulatedRainGauge('SMAC5')).toBe(false)
  })
})
