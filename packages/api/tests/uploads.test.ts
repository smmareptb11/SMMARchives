import { describe, expect, it } from 'vitest'

import { photoExtensionOf } from '../src/uploads.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (text: string) => [...text].map((one) => one.charCodeAt(0))

describe('the type a photo declares by its bytes', () => {
  it('reads a JPEG', () => {
    expect(photoExtensionOf(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('jpg')
  })

  it('reads a PNG', () => {
    expect(photoExtensionOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe(
      'png',
    )
  })

  it('reads a WebP', () => {
    expect(photoExtensionOf(bytes(...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')))).toBe(
      'webp',
    )
  })

  it('takes a RIFF that is not a WebP for nothing', () => {
    expect(photoExtensionOf(bytes(...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')))).toBe(
      undefined,
    )
  })

  it('takes a page or nothing at all for nothing', () => {
    expect(photoExtensionOf(bytes(...ascii('<!doctype html>')))).toBe(undefined)
    expect(photoExtensionOf(bytes())).toBe(undefined)
  })
})
