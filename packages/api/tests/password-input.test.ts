import { describe, expect, it } from 'vitest'

import { keyed, pipedPassword } from '../src/password-input.ts'

describe('a password given through a pipe', () => {
  it('loses the line ending the pipe added', () => {
    expect(pipedPassword('crue de 2018\n')).toBe('crue de 2018')
    expect(pipedPassword('crue de 2018\r\n')).toBe('crue de 2018')
  })

  it('keeps the spaces and tabs at its end, which are part of it', () => {
    expect(pipedPassword('crue de 2018 \n')).toBe('crue de 2018 ')
    expect(pipedPassword('crue de 2018\t')).toBe('crue de 2018\t')
  })
})

describe('a password typed without echo', () => {
  const typing = (keys: string[]) =>
    keys.reduce<ReturnType<typeof keyed>>(
      (state, key) => ('typed' in state ? keyed(state.typed, key) : state),
      { typed: '' },
    )

  it('ends on the return key', () => {
    expect(typing([...'crue', '\r'])).toEqual({ done: 'crue' })
  })

  it.each([
    ['DEL', '\u007f'],
    ['BS', '\b'],
  ])('erases the last character on %s', (_, erase) => {
    expect(typing([...'crux', erase, 'e', '\r'])).toEqual({ done: 'crue' })
  })

  it.each([
    ['Ctrl-C', '\u0003'],
    ['Ctrl-D', '\u0004'],
  ])('stops on %s rather than keeping it', (_, key) => {
    expect(typing([...'crue', key])).toEqual({ interrupted: true })
  })
})
