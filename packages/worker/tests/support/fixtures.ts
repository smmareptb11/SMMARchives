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

/**
 * The routes the station referential is read from: the list, and the network
 * links that type it.
 */
export function stationReferentialRoutes(): Record<string, StubbedResponse> {
  return {
    '/hydrologicalStation/': { json: fixture('aquasys/stations.json') },
    '/hydrologicalStation/networkLink': { json: fixture('aquasys/network-links.json') },
  }
}

export type StubbedResponse =
  | { json: unknown; headers?: Record<string, string> }
  | { text: string; headers?: Record<string, string> }
  | { status: number; body?: string }
  | { throws: Error }

/**
 * A `fetch` that answers from a table, so no test reaches a live source.
 *
 * Routes are matched by substring against the URL, longest first, which keeps
 * `/hydrologicalStation/84/threshold` from being caught by
 * `/hydrologicalStation/84`.
 */
export function fetchStub(routes: Record<string, StubbedResponse>): Fetch & { calls: string[] } {
  const patterns = Object.keys(routes).sort((a, b) => b.length - a.length)
  const calls: string[] = []

  const stub = (async (input: Parameters<Fetch>[0]) => {
    /* eslint-disable-next-line @typescript-eslint/no-base-to-string -- every caller hands this
       stub a string or a `URL`; anything else matches no pattern and throws below */
    const url = String(input)
    calls.push(url)

    const pattern = patterns.find((candidate) => url.includes(candidate))
    if (pattern === undefined) throw new Error(`No stubbed route for ${url}`)

    return toResponse(routes[pattern]!)
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

/**
 * More rows than V8 accepts as arguments to one call, one second apart from
 * 2018-10-15: generated, since no recorded response comes near that size. The
 * source and quantity are those of the request, whatever the rows carry.
 */
export function aSeriesBeyondTheArgumentLimit(): unknown[][] {
  const start = Date.parse('2018-10-15T00:00:00Z')
  return Array.from({ length: 150_000 }, (_, index) => [84, 4, start + index * 1000, 0.2, 0.2])
}
