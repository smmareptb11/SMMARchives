import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { RUNNER, SCRIPT, STDERR_KEPT, watch } from '../src/builds.ts'

/** A child of our own, so nothing here collects anything from anywhere. */
function saying(script: string) {
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] })
}

describe('following a build', () => {
  it('reports the exit code and what the child wrote', async () => {
    const child = saying(`process.stderr.write('ACYCLIQ_TOKEN: is required\\n'); process.exit(1)`)

    expect(await watch(child).exited).toEqual({
      code: 1,
      stderr: 'ACYCLIQ_TOKEN: is required\n',
    })
  })

  it('has the diagnostic in hand even when the child exits right after writing it', async () => {
    // `exit` fires before the pipes are drained; only `close` promises what
    // the child wrote last, which for a build is why it gave up.
    const child = saying(`process.stderr.write('x'.repeat(200000)); process.exit(1)`)

    const { code, stderr } = await watch(child).exited
    expect(code).toBe(1)
    expect(stderr.length).toBeGreaterThan(0)
  })

  it('keeps only as much of it as it said it would', async () => {
    const child = saying(`process.stderr.write('x'.repeat(200000)); process.exit(1)`)

    // Appending a whole chunk once under the limit let a single burst
    // through it, eight times over.
    expect((await watch(child).exited).stderr).toHaveLength(STDERR_KEPT)
  })

  it('reports a runner that is not there rather than never settling', async () => {
    const missing = spawn('/nowhere/tsx', [], { stdio: ['ignore', 'ignore', 'pipe'] })

    const { code, stderr } = await watch(missing).exited
    expect(code).toBe(1)
    expect(stderr).toContain('ENOENT')
  })

  it('reports a child that said nothing and left quietly', async () => {
    expect(await watch(saying('')).exited).toEqual({ code: 0, stderr: '' })
  })
})

describe('what a build is spawned from', () => {
  it('points at a runner and a script that are there', async () => {
    // Both are resolved by hops out of this package, and every test injects a
    // launcher — so nothing else would notice a move until production did.
    await expect(access(RUNNER)).resolves.toBeUndefined()
    await expect(access(SCRIPT)).resolves.toBeUndefined()
  })
})
