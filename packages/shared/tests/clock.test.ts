import { describe, expect, it } from 'vitest'

import {
  cropToWindow,
  fromEpochMilliseconds,
  fromEpochSeconds,
  isWithin,
  medianStepMinutes,
  parseInstant,
  windowOf,
} from '../src/clock.ts'

describe('normalising a source onto the single clock', () => {
  it('reads Aquasys epoch milliseconds', () => {
    expect(fromEpochMilliseconds(1539561900000)).toBe('2018-10-15T00:05:00.000Z')
  })

  it('reads radar delivery epoch seconds', () => {
    expect(fromEpochSeconds(1571668500)).toBe('2019-10-21T14:35:00.000Z')
  })

  it('reads Ceneau ISO 8601 with an explicit Z', () => {
    expect(parseInstant('2026-08-28T12:03:04.000Z')).toBe('2026-08-28T12:03:04.000Z')
  })

  it('refuses seconds passed as milliseconds', () => {
    expect(() => fromEpochMilliseconds(1571668500)).toThrow(/Implausible/)
  })

  it('refuses milliseconds passed as seconds', () => {
    expect(() => fromEpochSeconds(1539561900000)).toThrow(/Implausible/)
  })

  it('refuses an unparsable date rather than yielding an invalid instant', () => {
    expect(() => parseInstant('hier')).toThrow(/Unparsable/)
  })
})

describe('cropping to the requested window', () => {
  const window = windowOf('2018-10-15T06:00:00Z', '2018-10-15T12:00:00Z')

  it('refuses a window that ends before it starts', () => {
    expect(() => windowOf('2018-10-15T12:00:00Z', '2018-10-15T06:00:00Z')).toThrow(/ends before/)
  })

  it('includes both bounds', () => {
    expect(isWithin('2018-10-15T06:00:00.000Z', window)).toBe(true)
    expect(isWithin('2018-10-15T12:00:00.000Z', window)).toBe(true)
  })

  it('drops the extra days Aquasys widens the request to', () => {
    const rows = [
      { at: '2018-10-15T00:05:00.000Z' },
      { at: '2018-10-15T09:00:00.000Z' },
      { at: '2018-10-16T23:52:00.000Z' },
    ]
    expect(cropToWindow(rows, window, (row) => row.at)).toEqual([
      { at: '2018-10-15T09:00:00.000Z' },
    ])
  })
})

describe('reporting the density actually obtained', () => {
  it('has no median below two instants', () => {
    expect(medianStepMinutes(['2018-10-15T00:00:00.000Z'])).toBeNull()
  })

  it('measures an irregular, event-driven series', () => {
    const instants = [
      '2018-10-15T00:00:00.000Z',
      '2018-10-15T00:05:00.000Z',
      '2018-10-15T00:30:00.000Z',
      '2018-10-15T02:30:00.000Z',
    ]
    expect(medianStepMinutes(instants)).toBe(25)
  })

  it('does not depend on the order it receives', () => {
    const instants = [
      '2018-10-15T02:30:00.000Z',
      '2018-10-15T00:05:00.000Z',
      '2018-10-15T00:30:00.000Z',
      '2018-10-15T00:00:00.000Z',
    ]
    expect(medianStepMinutes(instants)).toBe(25)
  })
})
