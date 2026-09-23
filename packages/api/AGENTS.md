# AGENTS.md — packages/api

What the root file does not say and the code cannot carry alone. Read it with
the root [`AGENTS.md`](../../AGENTS.md), which it does not replace.

## An error body returns only what a schema accepted

`detail` may carry a replay identifier, which has cleared `replayIdSchema`, or
a data set name, which comes from `datasetNameSchema`. It never carries a media
path, a name the client invented, the standard error of a child process, or the
message of an error we did not raise ourselves. What cannot be said in the
response goes to the log.

The rule is written on `sendProblem`, the one passage every error body takes.
No sensor holds it: the first caller along has broken it three times — a data
set name, a build's standard error, the messages of a Zod error. Until the
shared schemas return a type distinct from `string`, nothing can tell a
validated identifier from a raw URL segment, and the rule stays a rule.

## No test starts a real collection

The build launcher is a seam: `ApiOptions.launch`. The tests' `appOn` helper
imposes a launcher that launches nothing by default, and that is what makes the
sentence true rather than hoped for. Mounting a test application without going
through it puts back the real `spawnBuild`, pointed at the real repository and
its `.env`.

## `docs/api.md` says what the API promises

A guarantee written there is verified before it is written. Three of its
assertions have already been false.
