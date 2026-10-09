import type { ErrorRequestHandler, Request, Response } from 'express'
import type { ZodError } from 'zod'

/** RFC 9457. `type` stays a bare token until the API has a documentation URL. */
type Problem = {
  type: string
  title: string
  status: number
  detail: string
  /** Which fields a schema refused, and why. Never the values it was sent. */
  refusals?: unknown
}

/**
 * The only way an error body leaves this API, and the one place its rule can be
 * held: **`detail` carries only values that have passed one of the API's own
 * schemas.** A replay identifier may appear, having cleared `replayIdSchema`;
 * a media path, a data set name and a build's `stderr` may not.
 *
 * Stated that way because the absolute version — never any client text — is
 * not what the code does, and a rule nobody follows teaches nothing. What
 * cannot be said in the response goes to the log.
 */
function sendProblem(res: Response, problem: Problem): void {
  res.status(problem.status).type('application/problem+json').json(problem)
}

export function badRequest(res: Response, detail: string, refusals?: unknown): void {
  sendProblem(res, {
    type: 'bad-request',
    title: 'Bad request',
    status: 400,
    detail,
    ...(refusals === undefined ? {} : { refusals }),
  })
}

/**
 * Which field a schema refused, and why — never the value it was sent, which
 * is the rule above applied to the one place a request's own text would slip
 * through.
 */
export function refusalsIn(error: ZodError): { path: string; message: string }[] {
  return error.issues.flatMap((issue) =>
    // A field nobody may send has no path of its own — the issue sits on the
    // object — and a refusal that named no field would leave a client guessing
    // which of its own it should drop.
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ path: key, message: 'is not a field of this request' }))
      : [{ path: issue.path.join('.'), message: issue.message }],
  )
}

export function notFound(res: Response, detail: string): void {
  sendProblem(res, { type: 'not-found', title: 'Not found', status: 404, detail })
}

export function conflict(res: Response, detail: string): void {
  sendProblem(res, { type: 'conflict', title: 'Conflict', status: 409, detail })
}

export function payloadTooLarge(res: Response, detail: string): void {
  sendProblem(res, { type: 'payload-too-large', title: 'Payload too large', status: 413, detail })
}

export function unsupportedMediaType(res: Response, detail: string): void {
  sendProblem(res, {
    type: 'unsupported-media-type',
    title: 'Unsupported media type',
    status: 415,
    detail,
  })
}

export function internalError(res: Response, detail: string): void {
  sendProblem(res, { type: 'internal', title: 'Internal error', status: 500, detail })
}

export function onUnknownRoute(_req: Request, res: Response): void {
  notFound(res, 'no route here')
}

/**
 * The last word on any failure, a rejected promise included: Express 5 forwards
 * those here on its own.
 *
 * An unexpected error carries what its thrower had in hand — an `fs` error
 * names an absolute path, a refused contract names fields and values — so it
 * reaches the log and never the response.
 */
export function errorHandler(log: (message: string) => void): ErrorRequestHandler {
  return (error, req, res, _next) => {
    // A malformed percent-escape makes Express throw a URIError carrying its
    // own 400, and a body too large a 413. Blaming the server for a request
    // nobody could read would also log a stack for every crawler that tries.
    const status = blamedOnTheClient(error)
    if (status === undefined) log(`${req.method} ${req.originalUrl} failed: ${describe(error)}`)

    // Headers gone means a body is already on its way, so nothing can be said
    // in it. Destroyed rather than left open: a half-written response the
    // client would wait on forever.
    if (res.headersSent) {
      res.destroy()
      return
    }
    if (status !== undefined) {
      sendProblem(res, {
        type: 'bad-request',
        title: 'Bad request',
        status,
        detail: 'the request could not be read',
      })
      return
    }
    sendProblem(res, {
      type: 'internal',
      title: 'Internal error',
      status: 500,
      detail: 'the request could not be served',
    })
  }
}

/** The status a thrower declared for the client, or undefined if it is ours. */
function blamedOnTheClient(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined
}

/** Everything the thrower knew, including a cause a stack leaves out. */
export function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const head = error.stack ?? `${error.name}: ${error.message}`
  return error.cause === undefined ? head : `${head}\ncaused by: ${describe(error.cause)}`
}
