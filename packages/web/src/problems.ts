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
 * What the API refused, read from its own body.
 *
 * Never rewritten here: the API says which field it refused and why, and a
 * second wording, kept in the browser, would drift from the one the server
 * holds without anybody noticing which of the two is right.
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
 * What to show a user about a failure, whatever its kind.
 *
 * A network that never answered is not a refusal and has no problem document:
 * saying so is better than showing the raw message of a `TypeError`.
 */
export function describe(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail
  return "L'API n'a pas répondu."
}
