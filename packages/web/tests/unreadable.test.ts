import { describe, expect, it } from 'vitest'

import { ApiError } from '../src/problems.ts'
import { confirmsSession, unreadableReplay } from '../src/unreadable.ts'

const NOT_FOUND = new ApiError({
  type: 'not-found',
  title: 'Not found',
  status: 404,
  detail: 'no replay aa9282b7-908a-48bf-85b3-aaa9642c021c',
})

const problem = (status: number, detail: string) =>
  new ApiError({ type: 'problem', title: 'Problem', status, detail })

describe('a replay that cannot be shown', () => {
  it('may be unpublished to a stranger, who is offered to sign in', () => {
    expect(unreadableReplay(NOT_FOUND, false)).toMatchObject({
      title: 'Ce rejeu n’est pas accessible',
      signIn: true,
      retry: false,
    })
  })

  it('is not said while the session is still being asked', () => {
    expect(unreadableReplay(NOT_FOUND, undefined)).toBeUndefined()
  })

  it('does not exist, to the administrator, who is sent to the list', () => {
    expect(unreadableReplay(NOT_FOUND, true)).toMatchObject({
      title: 'Ce rejeu n’existe pas',
      signIn: false,
      retry: false,
    })
  })

  /** An identifier the database never mints: the API's English sentence says why, the reader is told where. */
  it('is a wrong address when its identifier is malformed, and says nothing of the API', () => {
    const malformed = unreadableReplay(
      problem(400, 'must be the identifier the database minted'),
      true,
    )

    expect(malformed).toMatchObject({ title: 'Cette adresse ne mène à aucun rejeu', retry: false })
    expect(JSON.stringify(malformed)).not.toContain('minted')
  })

  it('offers to try again when the server failed, without its own words', () => {
    const failed = unreadableReplay(problem(500, 'the request could not be served'), true)

    expect(failed).toMatchObject({
      title: 'Ce rejeu ne peut pas être affiché',
      retry: true,
      signIn: false,
    })
    expect(JSON.stringify(failed)).not.toContain('could not be served')
  })

  it('offers to sign in again when the session ran out', () => {
    expect(unreadableReplay(problem(401, 'sign in first'), true)).toMatchObject({
      title: 'Votre session a expiré',
      signIn: true,
    })
  })

  it('says the server did not answer when nothing came back, and offers to try again', () => {
    expect(unreadableReplay(new TypeError('Failed to fetch'), true)).toMatchObject({
      title: 'Le serveur ne répond pas',
      retry: true,
      signIn: false,
    })
  })

  it('offers the sign-in to whoever is not signed in, whatever kept the replay out of sight', () => {
    for (const error of [problem(400, 'x'), problem(500, 'x'), new TypeError('Failed to fetch')]) {
      expect(unreadableReplay(error, false)?.signIn).toBe(true)
    }
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
