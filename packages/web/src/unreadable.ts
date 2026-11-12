import { ApiError, describe } from './problems.ts'

export type Unreadable = {
  said: string
  /** Whether signing in could show it: a stranger is not told which of the two it is. */
  signIn: boolean
}

/**
 * Why a replay cannot be shown, in the interface's language, or undefined
 * while that rests on a session not yet settled.
 *
 * The API answers a replay a stranger may not see as it answers one that does
 * not exist, so a stranger's 404 is both, and only the administrator's is one.
 */
export function unreadableReplay(
  error: unknown,
  signedIn: boolean | undefined,
): Unreadable | undefined {
  if (!isMissing(error)) return { said: describe(error), signIn: false }
  if (signedIn === undefined) return undefined
  if (signedIn) return { said: 'Ce rejeu n’existe pas.', signIn: false }
  return { said: 'Ce rejeu n’existe pas, ou il n’est pas public.', signIn: true }
}

/**
 * Whether the session must be asked again before saying anything.
 *
 * The interface learns of the session once, and it may have expired since: the
 * API then answers the administrator as a stranger, and "does not exist" would
 * be said of a replay that is only unpublished.
 */
export function confirmsSession(error: unknown, signedIn: boolean | undefined): boolean {
  return isMissing(error) && signedIn === true
}

function isMissing(error: unknown): boolean {
  return error instanceof ApiError && error.problem.status === 404
}
