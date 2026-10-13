import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import busboy from 'busboy'
import type { Request } from 'express'

/** A photo from a phone weighs a few megabytes; this leaves room and no more. */
export const PHOTO_SIZE_LIMIT = 15 * 1024 * 1024
export const PHOTO_COUNT_LIMIT = 10
/** What the JSON route accepts, so the two ways of sending an event agree. */
const EVENT_SIZE_LIMIT = 64 * 1024

export type PhotoExtension = 'jpg' | 'png' | 'webp'

/** Why a request was turned away, said in a way `detail` may carry. */
export type Refusal = { status: 400 | 413 | 415; detail: string; refusals?: unknown }

export type Accepted<T> = { report: T } | { refusals: unknown }

export type ReportReader<T> = {
  /** Judges the event, which arrives before any photo is kept. */
  accept: (body: unknown) => Accepted<T>
  /** Stores one photo and answers where it now lives. */
  keep: (photo: Uint8Array, extension: PhotoExtension) => Promise<string>
}

export type ReadReport<T> = { report: T; media: string[] } | Refusal

const UNREADABLE: Refusal = { status: 400, detail: 'the form could not be read' }
const MISSHAPEN: Refusal = { status: 400, detail: 'a form carries one event, then its photos' }

/**
 * The event and its photos, from either of the two shapes a client sends.
 *
 * JSON when there is no photo, a multipart form when there are: a photo has no
 * place in JSON but as base64, a third heavier, and held whole before it can
 * be checked.
 */
export function readReport<T>(req: Request, reader: ReportReader<T>): Promise<ReadReport<T>> {
  if (req.is('application/json')) {
    const accepted = reader.accept(req.body)
    return Promise.resolve(
      'report' in accepted ? { report: accepted.report, media: [] } : invalid(accepted.refusals),
    )
  }
  if (req.is('multipart/form-data')) return readForm(req, reader)
  return Promise.resolve({
    status: 415,
    detail: 'an event is sent as JSON, or as a form with its photos',
  })
}

/**
 * The type a photo's own bytes declare.
 *
 * Never the name or the type the client gave: the extension chosen here is the
 * type the photo is served under, for good, and an HTML page called `x.png`
 * must not become one.
 */
export function photoExtensionOf(bytes: Uint8Array): PhotoExtension | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, RIFF) && startsWith(bytes.subarray(8), WEBP)) return 'webp'
  return undefined
}

const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function invalid(refusals: unknown): Refusal {
  return { status: 400, detail: 'the event is not described correctly', refusals }
}

function readForm<T>(req: Request, reader: ReportReader<T>): Promise<ReadReport<T>> {
  return new Promise((settle) => {
    let parser: busboy.Busboy
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          fields: 1,
          fieldSize: EVENT_SIZE_LIMIT,
          files: PHOTO_COUNT_LIMIT,
          fileSize: PHOTO_SIZE_LIMIT,
        },
      })
    } catch {
      // A multipart type without its boundary: nothing to read the parts by.
      req.resume()
      settle(UNREADABLE)
      return
    }

    const form = new FormReading(reader)
    parser.on('field', (name, value, info) => form.field(name, value, info.valueTruncated))
    parser.on('file', (name, stream) => form.file(name, stream))
    parser.on('fieldsLimit', () => form.refuse(MISSHAPEN))
    parser.on('filesLimit', () =>
      form.refuse({ status: 413, detail: `an event carries ${PHOTO_COUNT_LIMIT} photos at most` }),
    )
    // Settled on `close`, not when the pipeline ends: the parser has taken in
    // the last byte before the last photo has been handed out.
    parser.on('close', () => settle(form.finish()))
    pipeline(req, parser).catch(() => {
      form.refuse(UNREADABLE)
      settle(form.finish())
    })
  })
}

/**
 * One form as it arrives, part after part.
 *
 * The event comes first so that it is judged before a single photo is written:
 * an event refused leaves nothing behind. A photo refused after others were
 * kept leaves those, which no event names and the replay's deletion removes.
 */
class FormReading<T> {
  readonly #reader: ReportReader<T>
  #report: T | undefined
  readonly #media: string[] = []
  #refusal: Refusal | undefined
  #failure: { error: unknown } | undefined
  /** Photos are kept one after the other, so their order is the order they were sent in. */
  #writes: Promise<void> = Promise.resolve()

  constructor(reader: ReportReader<T>) {
    this.#reader = reader
  }

  /** The first reason stands: what follows a refused part says nothing more. */
  refuse(refusal: Refusal): void {
    this.#refusal ??= refusal
  }

  field(name: string, value: string, truncated: boolean): void {
    if (this.#refusal !== undefined) return
    if (name !== 'event') return this.refuse(MISSHAPEN)
    if (truncated) return this.refuse({ status: 413, detail: 'the event weighs 64 kB at most' })

    let body: unknown
    try {
      body = JSON.parse(value)
    } catch {
      return this.refuse({ status: 400, detail: 'the event part is not JSON' })
    }
    const accepted = this.#reader.accept(body)
    if ('refusals' in accepted) return this.refuse(invalid(accepted.refusals))
    this.#report = accepted.report
  }

  file(name: string, stream: Readable): void {
    if (this.#refusal === undefined && name !== 'photo') this.refuse(MISSHAPEN)
    if (this.#refusal === undefined && this.#report === undefined) {
      this.refuse({ status: 400, detail: 'the event comes before its photos' })
    }
    if (this.#refusal !== undefined) {
      stream.resume()
      return
    }

    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('limit', () => this.refuse({ status: 413, detail: 'a photo weighs 15 MB at most' }))
    stream.on('end', () => this.#keep(Buffer.concat(chunks)))
  }

  #keep(photo: Uint8Array): void {
    if (this.#refusal !== undefined) return
    const extension = photoExtensionOf(photo)
    if (extension === undefined) {
      return this.refuse({ status: 415, detail: 'a photo is a JPEG, PNG or WebP image' })
    }
    this.#writes = this.#writes
      .then(async () => {
        if (this.#refusal !== undefined || this.#failure !== undefined) return
        this.#media.push(await this.#reader.keep(photo, extension))
      })
      // Held until the form is read, rather than left rejected with nobody
      // listening: Node takes an unhandled rejection down with the process.
      .catch((error: unknown) => {
        this.#failure ??= { error }
      })
  }

  async finish(): Promise<ReadReport<T>> {
    await this.#writes
    if (this.#failure !== undefined) throw this.#failure.error
    if (this.#refusal !== undefined) return this.#refusal
    if (this.#report === undefined) return MISSHAPEN
    return { report: this.#report, media: this.#media }
  }
}
