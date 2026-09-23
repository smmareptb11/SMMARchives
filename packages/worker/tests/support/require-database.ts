/**
 * Refuses a run of the `db` suites when no database is reachable.
 *
 * Vitest calls this before collecting, so the refusal is the first thing
 * printed rather than a line lost in a passing report. It exists because the
 * failure it replaces was silent: these suites used to skip themselves, and
 * `vitest run` answered 0 either way — a green run proved 334 tests of 537 and
 * said nothing about the difference.
 */
export default function requireDatabase(): void {
  if ((process.env.DATABASE_URL_TEST ?? '') !== '') return
  throw new Error(NO_DATABASE)
}

const NO_DATABASE = [
  'test-db — DATABASE_URL_TEST is not set, and the `db` suites cannot run without it.',
  '',
  'These suites store and read back through a real PostgreSQL. Doubling a port',
  'this wide would drift, and the failure mode would be a route passing against',
  'the double and failing against the database.',
  '',
  'Expected: `npm test` runs both suites, or it says which one it did not run.',
  '',
  'Fix:  docker compose up -d db',
  '      then set DATABASE_URL_TEST in .env — `.env.sample` gives its shape.',
  '',
  'Do not delete this setup, do not skip a suite to get past it, and do not',
  'report a run as passing when it did not run. To run only the suites that need',
  'nothing: `npm run test:unit`, which is a narrower claim and names itself as one.',
  '',
  'Read: AGENTS.md, section Commands.',
].join('\n')
