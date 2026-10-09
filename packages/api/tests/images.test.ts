import { describe, expect, it } from 'vitest'

import { imageExtensionOf } from '../src/images.ts'

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((one) => (typeof one === 'string' ? [...one].map((c) => c.charCodeAt(0)) : one)),
  )

describe('the format of an image an agent sent', () => {
  it('is read from its first bytes', () => {
    expect(imageExtensionOf(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('jpg')
    expect(imageExtensionOf(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('png')
    expect(imageExtensionOf(bytes('RIFF', 0x24, 0, 0, 0, 'WEBPVP8 '))).toBe('webp')
  })

  /** A RIFF container is also a sound or a video, and only its second tag says which. */
  it('is not a WebP for being a RIFF container', () => {
    expect(imageExtensionOf(bytes('RIFF', 0x24, 0, 0, 0, 'WAVEfmt '))).toBeUndefined()
  })

  it('is none of them for what a browser would run or a reader would open', () => {
    expect(imageExtensionOf(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeUndefined()
    expect(imageExtensionOf(bytes('%PDF-1.7'))).toBeUndefined()
    expect(imageExtensionOf(bytes())).toBeUndefined()
  })

  it('is none for a prefix cut short', () => {
    expect(imageExtensionOf(bytes(0x89, 'PN'))).toBeUndefined()
  })
})
