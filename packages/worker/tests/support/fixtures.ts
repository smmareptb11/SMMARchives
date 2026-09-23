import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Fetch } from '../../src/http.ts'

/**
 * Loads a response recorded from a real source.
 *
 * Fixtures are anonymised: `updateLogin` and the login at measure column 16
 * carry a placeholder, so a test can assert that neither reaches the output
 * without the repository holding a real name.
 */
export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name)) as unknown
}

export function fixtureText(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
}

export type StubbedResponse =
  | { json: unknown; headers?: Record<string, string> }
  | { text: string; headers?: Record<string, string> }
  | { status: number; body?: string }
  | { throws: Error }

/** A route may answer differently on each call, to model an expiring session. */
export type StubbedRoute = StubbedResponse | StubbedResponse[]

/**
 * A `fetch` that answers from a table, so no test reaches a live source.
 *
 * Routes are matched by substring against the URL, longest first, which keeps
 * `/hydrologicalStation/84/threshold` from being caught by
 * `/hydrologicalStation/84`.
 */
export function fetchStub(routes: Record<string, StubbedRoute>): Fetch & { calls: string[] } {
  const patterns = Object.keys(routes).sort((a, b) => b.length - a.length)
  const remaining = new Map<string, StubbedResponse[]>(
    Object.entries(routes).map(([pattern, route]) => [
      pattern,
      Array.isArray(route) ? [...route] : [],
    ]),
  )
  const calls: string[] = []

  const stub = (async (input: Parameters<Fetch>[0]) => {
    /* eslint-disable-next-line @typescript-eslint/no-base-to-string -- every caller hands this
       stub a string or a `URL`; anything else matches no pattern and throws below */
    const url = String(input)
    calls.push(url)

    const pattern = patterns.find((candidate) => url.includes(candidate))
    if (pattern === undefined) throw new Error(`No stubbed route for ${url}`)

    const route = routes[pattern]!
    if (!Array.isArray(route)) return toResponse(route)

    const answer = remaining.get(pattern)!.shift()
    if (answer === undefined) throw new Error(`Stubbed sequence for ${pattern} is exhausted`)
    return toResponse(answer)
  }) as Fetch & { calls: string[] }

  stub.calls = calls
  return stub
}

function toResponse(answer: StubbedResponse): Response {
  if ('throws' in answer) throw answer.throws
  if ('json' in answer) {
    return new Response(JSON.stringify(answer.json), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...answer.headers },
    })
  }
  if ('text' in answer) {
    return new Response(answer.text, { status: 200, headers: answer.headers ?? {} })
  }
  return new Response(answer.body ?? '', { status: answer.status })
}
