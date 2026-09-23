import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { NEEDS_DATABASE } from './support/needs-database.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PACKAGES = join(ROOT, 'packages')

/** The one module that reads `DATABASE_URL_TEST`. Everything else borrows it. */
const SOURCE = join(PACKAGES, 'worker', 'tests', 'support', 'database.ts')

const RELATIVE_IMPORT = /from\s+'(\.[^']+)'/g

async function testFiles(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await testFiles(path)))
    else if (entry.name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

/**
 * Whether a test file reaches the test database, through however many modules.
 *
 * Followed rather than grepped: no `.test.ts` imports `support/database.ts`
 * itself — the seven API suites reach it through `support/replay.ts`, which is
 * exactly the kind of hop a direct search would miss.
 */
async function reachesTheDatabase(entry: string): Promise<boolean> {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (file === SOURCE) return true

    const source = await readFile(file, 'utf8').catch(() => '')
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      queue.push(resolve(dirname(file), match[1]!))
    }
  }
  return false
}

describe('the list of suites that need a database', () => {
  it('holds exactly the test files that reach one', async () => {
    const reaching: string[] = []
    for (const file of await testFiles(PACKAGES)) {
      if (await reachesTheDatabase(file)) reaching.push(relative(ROOT, file))
    }

    expect(reaching.sort(), MISLISTED).toEqual([...NEEDS_DATABASE].sort())
  })
})

const MISLISTED = [
  'test-db — `NEEDS_DATABASE` no longer matches the suites that reach the database.',
  '',
  'That list is what splits `npm test` into its two projects. A suite missing',
  'from it runs under `unit`, where it connects anyway whenever the environment',
  'happens to carry `DATABASE_URL_TEST` — green, in the wrong project, against',
  'the real database and beside the schemas the `db` suites are using. A stale',
  'entry is worse: its `include` matches nothing and nobody is told.',
  '',
  'Expected: the list holds every test file whose imports reach',
  '`packages/worker/tests/support/database.ts`, and holds nothing else.',
  '',
  'Fix: add the file you wrote to `packages/worker/tests/support/needs-database.ts`,',
  '     or remove the entry you renamed. If your suite stores nothing, it should',
  '     not be importing a module that opens a pool.',
  '',
  'Do not answer this by skipping the case or by loosening the comparison. This',
  'test is the only thing standing between a hand-kept list and a silent gap.',
  '',
  'Read: AGENTS.md, section Commands.',
].join('\n')
