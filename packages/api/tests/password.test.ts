import { describe, expect, it } from 'vitest'

import { ConfigurationError } from '@smmarchives/shared'

import { hashPassword, parsePasswordHash, verifyPassword } from '../src/password.ts'

describe('the password hash', () => {
  it('opens with the password it was made from', async () => {
    const hash = parsePasswordHash(await hashPassword('crue de 2018'))
    expect(await verifyPassword('crue de 2018', hash)).toBe(true)
  })

  it('opens with nothing else', async () => {
    const hash = parsePasswordHash(await hashPassword('crue de 2018'))
    expect(await verifyPassword('crue de 2019', hash)).toBe(false)
  })

  it('salts each hash, so two administrators with one password cannot be told apart', async () => {
    expect(await hashPassword('crue de 2018')).not.toBe(await hashPassword('crue de 2018'))
  })

  it('holds no character a `.env` reader would expand', async () => {
    expect(await hashPassword('crue de 2018')).toMatch(/^scrypt:[\w:-]+$/)
  })

  it('reads a password typed composed or decomposed as the same one', async () => {
    const hash = parsePasswordHash(await hashPassword('Trèbes'))
    expect(await verifyPassword('Trèbes', hash)).toBe(true)
  })

  it('is refused at start-up when it is not what the script prints', () => {
    expect(() => parsePasswordHash('crue de 2018')).toThrow(ConfigurationError)
    expect(() => parsePasswordHash('$scrypt$ln=14$abc$def')).toThrow(/ADMIN_PASSWORD_HASH/)
  })

  it.each([
    ['a key cut short', (salt: string, key: string) => `${salt}:${key.slice(0, 1)}`],
    ['a salt cut short', (salt: string, key: string) => `${salt.slice(0, 1)}:${key}`],
  ])('is refused at start-up with %s', async (_, cut) => {
    const [, , , , salt = '', key = ''] = (await hashPassword('crue de 2018')).split(':')
    expect(() => parsePasswordHash(`scrypt:16384:8:1:${cut(salt, key)}`)).toThrow(
      /ADMIN_PASSWORD_HASH: is not what `npm run hash-password` prints/,
    )
  })

  it.each([
    ['a cost that is not a power of two', '16385:8:1'],
    ['a cost of one, which scrypt cannot halve', '1:8:1'],
    ['more memory than Node allows', '1048576:8:1'],
  ])('is refused at start-up when it holds %s', async (_, settings) => {
    const [, , , , salt, key] = (await hashPassword('crue de 2018')).split(':')
    expect(() => parsePasswordHash(`scrypt:${settings}:${salt}:${key}`)).toThrow(
      /ADMIN_PASSWORD_HASH: holds scrypt settings Node refuses/,
    )
  })
})
