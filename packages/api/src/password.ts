import { randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from 'node:crypto'

import { ConfigurationError } from '@smmarchives/shared'

/**
 * The administrator's password, as the environment carries it:
 * `scrypt:N:r:p:salt:key`, salt and key in base64url.
 *
 * Colons rather than the usual `$`: the `.env` is read by tools that expand a
 * `$` as a variable, and a hash cut short there refuses every password without
 * saying why.
 */
export type PasswordHash = {
  options: Required<Pick<ScryptOptions, 'N' | 'r' | 'p'>>
  salt: Buffer
  key: Buffer
}

/**
 * A salt of 16 bytes and a key of 32, as `hashPassword` writes them: a key cut
 * short is compared on what is left of it, and an empty one matches any
 * password.
 */
const SHAPE = /^scrypt:(\d+):(\d+):(\d+):([\w-]{22}):([\w-]{43})$/

/** Node's own defaults, which stay under its memory ceiling. */
const COST = { N: 16_384, r: 8, p: 1 }
const SALT_BYTES = 16
const KEY_BYTES = 32

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, KEY_BYTES, COST)
  const { N, r, p } = COST
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join(':')
}

export function parsePasswordHash(value: string): PasswordHash {
  const match = SHAPE.exec(value)
  if (match === null) {
    throw new ConfigurationError(
      'ADMIN_PASSWORD_HASH',
      'is not what `npm run hash-password` prints',
    )
  }
  const [N = NaN, r = NaN, p = NaN] = match.slice(1, 4).map(Number)
  const options = { N, r, p }
  const salt = Buffer.from(match[4] ?? '', 'base64url')
  // Tried once here, at start-up: settings scrypt refuses — a cost that is not
  // a power of two, or that needs more memory than Node allows — would
  // otherwise let the API start, and answer every sign-in with a 500.
  try {
    scryptSync('', salt, 1, options)
  } catch {
    throw new ConfigurationError('ADMIN_PASSWORD_HASH', 'holds scrypt settings Node refuses')
  }
  return { options, salt, key: Buffer.from(match[5] ?? '', 'base64url') }
}

export async function verifyPassword(password: string, hash: PasswordHash): Promise<boolean> {
  const key = await derive(password, hash.salt, hash.key.length, hash.options)
  return timingSafeEqual(key, hash.key)
}

function derive(
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((settle, fail) => {
    scrypt(password.normalize('NFC'), salt, length, options, (error, key) => {
      if (error === null) settle(key)
      else fail(error)
    })
  })
}
