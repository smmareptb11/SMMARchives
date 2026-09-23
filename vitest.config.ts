import { loadEnv } from 'vite'
import { defaultExclude, defineConfig } from 'vitest/config'

import { NEEDS_DATABASE } from './packages/worker/tests/support/needs-database.ts'

/**
 * The repository's own `.env`, for the suites, with the shell winning.
 *
 * Every other script reaches it through `tsx --env-file-if-exists=.env`; Vitest
 * has no such flag, so `npm test` refused to start on a machine whose `.env`
 * held `DATABASE_URL_TEST` — the very file `.env.sample` tells a reader to copy.
 */
process.env = { ...loadEnv('test', process.cwd(), ''), ...process.env }

/**
 * Two suites, each named, so that a green run says what it covered.
 *
 * `npm test` runs both and refuses to start without a database. `npm run
 * test:unit` runs `unit` alone: a narrower claim, and one nobody makes by
 * accident. `database-guard.test.ts`, which runs under `unit`, is what keeps
 * the split honest — the list is hand-kept, and nothing else checks it.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/tests/**/*.test.ts'],
          exclude: [...defaultExclude, ...NEEDS_DATABASE],
        },
      },
      {
        test: {
          name: 'db',
          include: NEEDS_DATABASE,
          globalSetup: ['packages/worker/tests/support/require-database.ts'],
        },
      },
    ],
  },
})
