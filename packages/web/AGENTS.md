# AGENTS.md — packages/web

What the root file does not say and the code cannot carry alone. Read it with
the root [`AGENTS.md`](../../AGENTS.md), which it does not replace.

## A dependency list is checked, and an omission is explained

`react-hooks/exhaustive-deps` is an error here. A hook watching the wrong value
produces no wrong result: it redraws at the wrong moment, or reads a value from
a frame that is gone. Which is why four lists were wrong for two days and a
reader, not a command, is what found them.

Deliberate omissions exist, and the four here are of three kinds.

- **A memoised member inside an object rebuilt on every render.** `useCursor`
  returns a new object each time, and its callbacks are stable: a hook watches
  the members, never the object, or it rebinds a listener sixty times a second.
- **The fields read, rather than the record holding them.** The manifest is
  stable, but watching it whole would reload every data set when its state or
  its journal moved.
- **A value read once to build a first frame.** `StationChart` reads `at` and
  `ladder` to draw, and follows neither: a second effect follows `at`, and a
  different ladder is a different component through the key upstream.

Four of them say so on the line above, after `--`. **A disable without a reason
is not an answer to this rule.** Unused directives are an error too, so the day
a hook stops needing its exemption, the exemption is what fails. Read
`useCursor`'s own comment before writing a fifth.
