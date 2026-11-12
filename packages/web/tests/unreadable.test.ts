import { describe, expect, it } from 'vitest'

import { ApiError } from '../src/problems.ts'
import { confirmsSession, unreadableReplay } from '../src/unreadable.ts'

const NOT_FOUND = new ApiError({
  type: 'not-found',
  title: 'Not found',
  status: 404,
  detail: 'no replay aa9282b7-908a-48bf-85b3-aaa9642c021c',
})

describe('a replay that cannot be shown', () => {
  it('may be unpublished to a stranger, who is offered to sign in', () => {
    expect(unreadableReplay(NOT_FOUND, false)).toEqual({
      said: 'Ce rejeu n’existe pas, ou il n’est pas public.',
      signIn: true,
    })
  })

  it('is not said while the session is still being asked', () => {
    expect(unreadableReplay(NOT_FOUND, undefined)).toBeUndefined()
  })

  it('does not exist, to the administrator', () => {
    expect(unreadableReplay(NOT_FOUND, true)).toEqual({
      said: 'Ce rejeu n’existe pas.',
      signIn: false,
    })
  })

  it('keeps what the API said of any other refusal', () => {
    const refused = new ApiError({
      type: 'internal',
      title: 'Internal error',
      status: 500,
      detail: 'the request could not be served',
    })
    expect(unreadableReplay(refused, false)).toEqual({
      said: 'the request could not be served',
      signIn: false,
    })
  })

  it('says the API did not answer when nothing came back', () => {
    expect(unreadableReplay(new TypeError('Failed to fetch'), false)).toEqual({
      said: "L'API n'a pas répondu.",
      signIn: false,
    })
  })
})

describe('the session behind a replay that cannot be shown', () => {
  it('is asked again when the administrator is told it is missing', () => {
    expect(confirmsSession(NOT_FOUND, true)).toBe(true)
  })

  it('is left alone for a stranger, or while it is still being asked', () => {
    expect(confirmsSession(NOT_FOUND, false)).toBe(false)
    expect(confirmsSession(NOT_FOUND, undefined)).toBe(false)
  })

  it('is left alone for a refusal that says nothing of the session', () => {
    expect(confirmsSession(new TypeError('Failed to fetch'), true)).toBe(false)
  })
})
