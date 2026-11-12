import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, sessionLost } from '../src/api.ts'
import { ApiError, describe as describeError } from '../src/problems.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function answering(status: number, body: unknown): void {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(body), { status })))
}

const REPLAY = 'c4a7c5be-73d0-48db-aa17-8be7b314f863'

describe('a write refused for want of a session', () => {
  it('says the session is lost, whichever write it was', async () => {
    const lost = vi.fn()
    sessionLost.addEventListener('lost', lost)
    answering(401, { type: 'unauthorized', title: 'Unauthorized', status: 401, detail: 'x' })

    await expect(api.removeEvent(REPLAY, 'an-event')).rejects.toBeInstanceOf(ApiError)
    await expect(api.publish(REPLAY)).rejects.toBeInstanceOf(ApiError)
    sessionLost.removeEventListener('lost', lost)
    expect(lost).toHaveBeenCalledTimes(2)
  })

  it('tells the reader, in French, what to do about it', async () => {
    answering(401, {
      type: 'unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'sign in to change anything',
    })
    const refused = await api.removeEvent(REPLAY, 'an-event').catch((error: unknown) => error)
    expect(describeError(refused)).toBe('Votre session a expiré : reconnectez-vous.')
  })

  it('is not said of any other refusal', async () => {
    const lost = vi.fn()
    sessionLost.addEventListener('lost', lost)
    answering(409, { type: 'conflict', title: 'Conflict', status: 409, detail: 'x' })

    await expect(api.publish(REPLAY)).rejects.toBeInstanceOf(ApiError)
    sessionLost.removeEventListener('lost', lost)
    expect(lost).not.toHaveBeenCalled()
  })
})
