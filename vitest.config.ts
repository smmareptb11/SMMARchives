import { loadEnv } from 'vite'
import { defaultExclude, defineConfig } from 'vitest/config'

import { NEEDS_DATABASE } from './packages/worker/tests/support/needs-database.ts'

/**
 * The repository's own `.env`, for the suites, with the shell winning: other
 * scripts load it through `tsx --env-file-if-exists=.env`, a flag Vitest lacks.
 */
process.env = { ...loadEnv('test', process.cwd(), ''), ...process.env }

/**
 * Two suites, each named, so that a green run says what it covered: `npm test`
 * runs both and needs a database, `npm run test:unit` runs `unit` alone. The
 * `NEEDS_DATABASE` list is hand-kept; only `database-guard.test.ts` checks it.
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
