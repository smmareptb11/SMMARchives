import { SourceError } from '@smmarchives/shared'

export type Fetch = typeof globalThis.fetch

export type HttpClientOptions = {
  /** Injected so tests never reach a live source. */
  fetch?: Fetch | undefined
  timeoutMs?: number
  headers?: Record<string, string>
  /**
   * Minimum delay between two requests.
   *
   * The SMMAR Lizmap is a crisis tool in production; its collectors space their
   * calls rather than run flat out.
   */
  minIntervalMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export class HttpClient {
  readonly #fetch: Fetch
  readonly #timeoutMs: number
  readonly #headers: Record<string, string>
  readonly #minIntervalMs: number
  #nextAllowedAt = 0

  constructor(options: HttpClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#headers = options.headers ?? {}
    this.#minIntervalMs = options.minIntervalMs ?? 0
  }

  async text(url: string, init: RequestInit = {}): Promise<string> {
    const response = await this.response(url, init)
    return response.text()
  }

  async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.response(url, init)
    const body = await response.text()
    try {
      return JSON.parse(body) as unknown
    } catch (cause) {
      throw new SourceError('Response is not JSON', {
        url,
        status: response.status,
        body,
        cause,
      })
    }
  }

  /**
   * Performs the request, turning anything but a 2xx into a {@link SourceError}.
   *
   * The body is kept on failure: Aquasys answers HTTP 500 and HTTP 400 with an
   * empty body, and Lizmap answers HTTP 200 with a `ServiceException` inside, so
   * neither the status nor the body alone tells you what went wrong.
   */
  async response(url: string, init: RequestInit = {}): Promise<Response> {
    await this.#waitForSlot()

    let response: Response
    try {
      response = await this.#fetch(url, {
        ...init,
        headers: merge(this.#headers, init.headers),
        signal: init.signal ?? AbortSignal.timeout(this.#timeoutMs),
      })
    } catch (cause) {
      throw new SourceError(messageOf(cause), { url, cause })
    }

    if (!response.ok) {
      throw new SourceError(`HTTP ${response.status} ${response.statusText}`.trim(), {
        url,
        status: response.status,
        body: await response.text().catch(() => ''),
      })
    }
    return response
  }

  async #waitForSlot(): Promise<void> {
    if (this.#minIntervalMs === 0) return

    const wait = this.#nextAllowedAt - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    this.#nextAllowedAt = Date.now() + this.#minIntervalMs
  }
}

/**
 * Spreading a `HeadersInit` silently yields `{}` unless it is a plain object,
 * and what would go missing is the Aquasys content type — a request that then
 * fails for the wrong reason.
 */
function merge(base: Record<string, string>, extra: RequestInit['headers']): Headers {
  const headers = new Headers(base)
  new Headers(extra).forEach((value, name) => headers.set(name, value))
  return headers
}

export function withQuery(
  url: string,
  parameters: Record<string, string | number | undefined>,
): string {
  const built = new URL(url)
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) built.searchParams.set(key, String(value))
  }
  return built.toString()
}

/**
 * Node wraps a network failure as a bare `fetch failed` and hides what actually
 * went wrong — DNS, TLS, refused connection — one level down in `cause`.
 */
function messageOf(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'Request timed out'
  if (!(error instanceof Error)) return String(error)

  const causes: string[] = []
  for (let cause = error.cause; cause instanceof Error; cause = cause.cause) {
    causes.push(cause.message)
  }
  return causes.length === 0 ? error.message : `${error.message}: ${causes.join(': ')}`
}
