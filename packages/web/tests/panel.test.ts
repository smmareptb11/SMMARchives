import { describe, expect, it } from 'vitest'

import { formKeyOf } from '../src/events/usePanel.ts'

describe('which form the panel holds', () => {
  /** A form opened further on in the reading starts there, and holds nothing typed. */
  it('is a fresh one when reporting is asked for at another instant', () => {
    expect(formKeyOf('2019-10-22T04:00:00.000Z', undefined)).not.toBe(
      formKeyOf('2019-10-22T07:00:00.000Z', undefined),
    )
  })

  it('is the same one when asked for again at the same instant', () => {
    expect(formKeyOf('2019-10-22T04:00:00.000Z', undefined)).toBe(
      formKeyOf('2019-10-22T04:00:00.000Z', undefined),
    )
  })

  it('is the event’s own when amending, whatever the instant', () => {
    expect(formKeyOf('2019-10-22T04:00:00.000Z', { id: 'a' })).toBe(
      formKeyOf('2019-10-22T07:00:00.000Z', { id: 'a' }),
    )
    expect(formKeyOf('2019-10-22T04:00:00.000Z', { id: 'a' })).not.toBe(
      formKeyOf('2019-10-22T04:00:00.000Z', { id: 'b' }),
    )
  })
})
