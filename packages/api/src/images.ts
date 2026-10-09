/**
 * The extension an image is stored under, read from its first bytes.
 *
 * Never from the name it was sent under nor the type it was declared with:
 * both are the client's word, and the extension is what decides the type the
 * medium is served with for good. Only the formats a freeze keeps are named;
 * anything else answers undefined, and is refused.
 */
export function imageExtensionOf(bytes: Uint8Array): 'jpg' | 'png' | 'webp' | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  // `RIFF`, four bytes of length, then `WEBP`: a RIFF container is also a WAV
  // or an AVI, and only the second tag says which.
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes.subarray(8), ascii('WEBP'))) {
    return 'webp'
  }
  return undefined
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte)
}

function ascii(tag: string): number[] {
  return [...tag].map((one) => one.charCodeAt(0))
}
