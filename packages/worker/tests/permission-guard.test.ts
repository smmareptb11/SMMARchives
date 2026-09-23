import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Owner loses read or write: 0o000 through 0o5xx. 0o644 and 0o755 do not. */
const RESTRICTIVE = /0o[0-5][0-7][0-7]/
const GUARD = 'process.getuid?.() === 0'

async function testFiles(): Promise<string[]> {
  const found: string[] = []
  for (const pack of await readdir(PACKAGES)) {
    const tests = join(PACKAGES, pack, 'tests')
    for (const entry of await readdir(tests).catch(() => [])) {
      if (entry.endsWith('.test.ts')) found.push(join(tests, entry))
    }
  }
  return found
}

describe('a test file that takes a permission away', () => {
  it('skips itself under root', async () => {
    const unguarded: string[] = []
    for (const file of await testFiles()) {
      const source = await readFile(file, 'utf8')
      if (RESTRICTIVE.test(source) && !source.includes(GUARD)) {
        unguarded.push(file.slice(PACKAGES.length + 1))
      }
    }

    expect(
      unguarded,
      [
        'permission-guard: a test file removes a permission and never skips under root.',
        'Root bypasses every permission bit, so the code under test succeeds where',
        'the test expects it to fail: green on a laptop, red in a container — or,',
        'worse, green in both while asserting nothing.',
        `Expected: each such file carries a test guarded by \`${GUARD}\`.`,
        'Fix: wrap the case in `it.skipIf(process.getuid?.() === 0)(...)`, with the',
        'one-line reason above it, as packages/worker/tests/build-replay.test.ts does.',
        'Do not widen the mode to make it pass, and do not exclude the file here:',
        'both turn a test that proves something into one that proves nothing.',
        'Why this rule exists: PR « feat(api): delete a replay » — two permission',
        'tests shipped without it and were caught by review, not by the suite.',
      ].join('\n'),
    ).toEqual([])
  })
})
