/**
 * Process exit codes shared by every collection script.
 *
 * `partial` exists so that a caller can tell "94 stations, all answered" from
 * "94 stations, 93 answered" without parsing the report: an empty result is a
 * success, a truncated one is not.
 */
export const ExitCode = {
  success: 0,
  failure: 1,
  partial: 2,
} as const

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]

const BODY_EXCERPT_LENGTH = 500

const SECRET_QUERY_PARAMETERS = ['token', 'apikey', 'api_key', 'access_token']

/** Strips credentials a URL may carry, so it can be printed and logged. */
export function redactUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  for (const parameter of SECRET_QUERY_PARAMETERS) {
    if (parsed.searchParams.has(parameter)) {
      parsed.searchParams.set(parameter, '<redacted>')
    }
  }
  return parsed.toString()
}

/**
 * An external source answered in a way we cannot use, or did not answer.
 *
 * Carries what is needed to diagnose the failure without replaying the call:
 * Aquasys returns opaque HTTP 500s and Lizmap returns HTTP 200 bodies holding a
 * `ServiceException`, so neither the status nor the body alone is enough.
 */
export class SourceError extends Error {
  readonly url: string
  readonly status: number | undefined
  readonly bodyExcerpt: string | undefined

  constructor(
    message: string,
    details: { url: string; status?: number; body?: string; cause?: unknown },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'SourceError'
    this.url = redactUrl(details.url)
    this.status = details.status
    this.bodyExcerpt = excerpt(details.body)
  }

  override toString(): string {
    const parts = [`${this.name}: ${this.message}`, `  url    ${this.url}`]
    if (this.status !== undefined) parts.push(`  status ${this.status}`)
    if (this.bodyExcerpt !== undefined) parts.push(`  body   ${this.bodyExcerpt}`)
    return parts.join('\n')
  }
}

/** A required environment variable is missing or unusable. */
export class ConfigurationError extends Error {
  readonly variable: string

  constructor(variable: string, reason: string) {
    super(`${variable}: ${reason}. See .env.sample.`)
    this.name = 'ConfigurationError'
    this.variable = variable
  }
}

function excerpt(body: string | undefined): string | undefined {
  if (body === undefined) return undefined
  // Bound before collapsing: an HTML error page would otherwise be scanned whole.
  const collapsed = body
    .slice(0, BODY_EXCERPT_LENGTH * 4)
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed === '') return undefined
  return collapsed.length > BODY_EXCERPT_LENGTH
    ? `${collapsed.slice(0, BODY_EXCERPT_LENGTH)}…`
    : collapsed
}
