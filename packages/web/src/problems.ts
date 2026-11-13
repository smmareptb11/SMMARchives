/** The one shape the API answers a refusal in: RFC 9457, and nothing else. */
export type ApiProblem = {
  type: string
  title: string
  status: number
  detail: string
  /** Which field a schema refused, and why. Present on a 400 from a schema. */
  refusals?: { path: string; message: string }[]
}

/**
 * What the API refused, read from its own body and never reworded here: a second
 * wording, kept in the browser, would drift from the server's.
 */
export async function problemOf(response: Response): Promise<ApiProblem> {
  try {
    return (await response.json()) as ApiProblem
  } catch {
    return {
      type: 'unreadable',
      title: 'Réponse illisible',
      status: response.status,
      detail: `L'API a répondu ${String(response.status)} sans rien d'interprétable.`,
    }
  }
}

export class ApiError extends Error {
  constructor(readonly problem: ApiProblem) {
    super(problem.detail)
    this.name = 'ApiError'
  }
}

/**
 * What to show a user about a failure, whatever its kind: a network that never
 * answered has no problem document, and is said so rather than as a `TypeError`.
 */
export function describe(error: unknown): string {
  // The one refusal the interface words itself: its only cause here is a
  // session that has run out, and the reader is owed what to do about it.
  if (error instanceof ApiError && error.problem.status === 401) {
    return 'Votre session a expiré : reconnectez-vous.'
  }
  if (error instanceof ApiError) return error.problem.detail
  return "L'API n'a pas répondu."
}
