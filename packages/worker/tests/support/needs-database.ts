/**
 * The test files that need PostgreSQL, listed one by one: they sit in the same
 * directories as the files that need nothing, so no pattern separates them.
 *
 * `vitest.config.ts` reads this to build its two projects, and
 * `database-guard.test.ts` checks the list against the import graph. Kept here
 * rather than in the config so that checking it costs no side effect.
 */
export const NEEDS_DATABASE = [
  'packages/api/tests/create.test.ts',
  'packages/api/tests/datasets.test.ts',
  'packages/api/tests/delete.test.ts',
  'packages/api/tests/events.test.ts',
  'packages/api/tests/journal.test.ts',
  'packages/api/tests/media.test.ts',
  'packages/api/tests/progress.test.ts',
  'packages/api/tests/replays.test.ts',
  'packages/worker/tests/build-replay-cli.test.ts',
  'packages/worker/tests/build-replay.test.ts',
  'packages/worker/tests/db-migrate.test.ts',
  'packages/worker/tests/replay-aquasys.test.ts',
  'packages/worker/tests/replay-lizmap.test.ts',
  'packages/worker/tests/replay-postgres-datasets.test.ts',
  'packages/worker/tests/replay-postgres-journal.test.ts',
  'packages/worker/tests/replay-postgres-manifest.test.ts',
  'packages/worker/tests/replay-postgres-store.test.ts',
]
