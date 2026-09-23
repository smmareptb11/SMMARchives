import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * A promise nobody waits for loses its rejection, and an unhandled rejection
 * takes the process down. The four rules below are the ones a repository this
 * full of async file work cannot hold by reading.
 */
const promises = {
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-unnecessary-condition': 'error',
}

const NO_DOUBLE_ASSERTION = [
  'A double assertion silences the compiler instead of answering it.',
  '`x as unknown as T` says nothing about x, and the object it produces keeps',
  'whatever shape it had — a fake port built this way drifts from the real one',
  'without a single error, until it is the test that lies.',
  'Fix: build the object so its type holds, or widen the port it stands for.',
  'See packages/api/tests/support/replay.ts, whose helpers are typed.',
].join(' ')

const NO_PIPE_ON_A_RESPONSE = [
  '`.pipe()` neither forwards the source error nor destroys the source.',
  'On a response path that means two failures already met here: a closed tab',
  'leaked a descriptor per download, and a read that failed after the headers',
  'were sent killed the process.',
  'Fix: `await pipeline(source, res)` from `node:stream/promises`, which',
  'propagates the error and destroys both ends.',
].join(' ')

/**
 * Sizes a function may not exceed. They name no error already made here: they
 * exist so a function that grows past reading cannot do it quietly.
 *
 * They are errors, and nothing is tolerated anonymously. Every threshold the
 * repository crosses today carries, on the line above it, the reason it is
 * crossed — and `reportUnusedDisableDirectives` takes that reason away again
 * the day the function comes back under the line.
 *
 * They were warnings until 12/09/2026, and warnings were a check with the plug
 * out: `eslint .` exits 0 whatever the count, so twenty crossings became
 * twenty-nine in the thirty-two hours that followed, unseen. Writing thirty-two
 * reasons is the price of the count meaning something.
 *
 * What those reasons say, read together: a threshold sometimes measures the
 * wrong thing. Sixteen of `writeManifest`'s nineteen branches are an optional
 * field becoming a SQL null, and a `describe` body counts its cases plus the
 * scaffolding they share. Raising a threshold is a decision, and it is made
 * here rather than by adding one more reason.
 */
const limits = {
  complexity: ['error', 8],
  'max-depth': ['error', 3],
  'max-params': ['error', 4],
  'max-statements': ['error', 15],
  'max-nested-callbacks': ['error', 3],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
  'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
}

/**
 * Rules the compiler cannot hold, and the sizes it does not judge. Nothing
 * about style: Prettier owns the shape and none of it is arbitrated here.
 *
 * A rule enters for one of two reasons — it names an error this repository has
 * already made, or it guides what is about to be written. Never for taste.
 */
export default tseslint.config(
  // A reason that has stopped being true is a reason that has to go: an unused
  // directive fails, so no exemption outlives the shape that justified it.
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  { ignores: ['data/'] },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx', 'packages/*/tests/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...promises,
      ...limits,

      // Express recognises an error handler by its four parameters. Dropping
      // `_next` would silently unregister the handler it guards.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // The journal rethrows the reason a write rejected with. Wrapping it would
      // replace the real error with one nobody raised.
      '@typescript-eslint/only-throw-error': ['error', { allowThrowingUnknown: true }],

      // Implementing an asynchronous port synchronously is legitimate: the
      // signature belongs to the port, not to whoever satisfies it.
      '@typescript-eslint/require-await': 'off',

      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
          message: NO_DOUBLE_ASSERTION,
        },
      ],
    },
  },
  {
    // `describe` and `it` nest functions mechanically, and a test file holds one
    // case per behaviour rather than one function per idea. Four limits are
    // widened for that reason alone; the three that measure a single function's
    // difficulty are not.
    //
    // `max-statements` is the fourth, and it was the last to move. A `describe`
    // body is a list of cases, so the rule counted behaviours and called them
    // steps — twenty-two in the largest suite here. Exempting the two that
    // crossed would have left them with no ceiling at all rather than a higher
    // one, which is the wrong trade in a repository agents write in. Twenty-five
    // is the round value above what the suites hold today, and it still catches
    // a helper that grows past reading.
    files: ['packages/*/tests/**/*.ts'],
    rules: {
      'max-statements': ['error', 25],
      'max-nested-callbacks': ['error', 4],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],

      // These catch something real: a test that reads `any` cannot notice a
      // contract drifting under it. They were warnings while 75 of them stood;
      // the typed reading helper that replaced the bare `JSON.parse` calls has
      // since taken every one, so they hold the ground it won.
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
    },
  },
  {
    // A dependency list is the one contract of a component that neither the
    // compiler nor a test of a pure module can read: `web/tests/` covers what
    // decides, and a hook watching the wrong value decides nothing wrong — it
    // redraws at the wrong moment, or reads a value from a frame that is gone.
    //
    // Four lists were already wrong when this landed, found one at a time by
    // hand. The plugin's own message says what to correct but not that a
    // `eslint-disable` is not the answer; a deliberate omission carries its
    // reason on the line above it, and `reportUnusedDisableDirectives` takes it
    // away again the day the code stops needing it.
    files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['packages/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
          message: NO_DOUBLE_ASSERTION,
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='pipe']",
          message: NO_PIPE_ON_A_RESPONSE,
        },
      ],
    },
  },
)
