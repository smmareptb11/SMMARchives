import { Readable } from 'node:stream'
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
  /**
   * Stores one photo as its bytes arrive, and answers where it now lives. A
   * body that fails on the way leaves nothing stored.
   */
  keep: (photo: ReadableStream<Uint8Array>, extension: PhotoExtension) => Promise<string>
}

export type ReadReport<T> = { report: T; media: string[] } | Refusal

const UNREADABLE: Refusal = { status: 400, detail: 'the form could not be read' }
const MISSHAPEN: Refusal = { status: 400, detail: 'a form carries one event, then its photos' }

/**
 * The event and its photos, as JSON when there is no photo and as a multipart
 * form when there are: in JSON a photo would be base64, a third heavier, and
 * held whole before it can be checked.
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
 * The type a photo's own bytes declare, never the one the client gave: it is
 * the type the photo is served under, for good, and an HTML page called `x.png`
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
/** The bytes `photoExtensionOf` reads: a WebP says what it is at bytes 8 to 11. */
const SIGNATURE_LENGTH = 12

const TOO_HEAVY: Refusal = { status: 413, detail: 'a photo weighs 15 MB at most' }
const NOT_A_PHOTO: Refusal = { status: 415, detail: 'a photo is a JPEG, PNG or WebP image' }

/** Raised into a photo being written, so the write leaves nothing behind. */
class CutShort extends Error {}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

/** The first bytes of a photo, as many as its signature takes, or all of it if fewer. */
async function headOf(chunks: AsyncIterator<Buffer>): Promise<Buffer> {
  let head = Buffer.alloc(0)
  while (head.length < SIGNATURE_LENGTH) {
    const next = await chunks.next()
    if (next.done === true) break
    head = Buffer.concat([head, next.value])
  }
  return head
}

/** The whole photo again, its head first, cut short if busboy found it too heavy. */
async function* rejoined(
  head: Buffer,
  chunks: AsyncIterator<Buffer>,
  stream: Readable,
): AsyncGenerator<Buffer> {
  yield head
  for (let next = await chunks.next(); next.done !== true; next = await chunks.next()) {
    yield next.value
  }
  // Busboy ends a photo past its limit as if it were whole, and marks it.
  if ((stream as Readable & { truncated?: boolean }).truncated === true) throw new CutShort()
}

/** Reads what is left of a part nobody keeps, so the form goes on to the next one. */
async function drain(chunks: AsyncIterator<unknown>): Promise<void> {
  for (let next = await chunks.next(); next.done !== true; next = await chunks.next()) {
    // Read and let go.
  }
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
          // One byte past the limit: busboy calls a file that reaches its
          // limit too heavy, and a photo of the limit exactly is allowed.
          fileSize: PHOTO_SIZE_LIMIT + 1,
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
 * One form as it arrives, the event first, so that a refused event leaves no
 * photo behind. A photo refused after others leaves those, which no event names
 * and the replay's deletion removes.
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

    stream.on('limit', () => this.refuse(TOO_HEAVY))
    this.#writes = this.#writes
      .then(() => this.#keep(stream))
      // Held until the form is read, rather than left rejected with nobody
      // listening: Node takes an unhandled rejection down with the process.
      .catch((error: unknown) => {
        this.#failure ??= { error }
      })
  }

  /**
   * Writes a photo as it arrives, a chunk at a time, once its first bytes have
   * given its type. One too heavy is cut short mid-write, which leaves nothing.
   */
  async #keep(stream: Readable): Promise<void> {
    const chunks = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>
    if (this.#refusal !== undefined || this.#failure !== undefined) return drain(chunks)

    const head = await headOf(chunks)
    const extension = photoExtensionOf(head)
    if (extension === undefined) {
      this.refuse(NOT_A_PHOTO)
      return drain(chunks)
    }

    try {
      const body = Readable.from(rejoined(head, chunks, stream))
      this.#media.push(
        await this.#reader.keep(Readable.toWeb(body) as ReadableStream<Uint8Array>, extension),
      )
    } catch (error) {
      if (!(error instanceof CutShort)) throw error
    }
  }

  async finish(): Promise<ReadReport<T>> {
    await this.#writes
    if (this.#failure !== undefined) throw this.#failure.error
    if (this.#refusal !== undefined) return this.#refusal
    if (this.#report === undefined) return MISSHAPEN
    return { report: this.#report, media: this.#media }
  }
}
