# AGENTS.md

Instructions for AI coding agents: what you cannot infer from the repository
itself. The README and `docs/` describe the software for whoever installs, runs
and calls it.

## The project

SMMARchives replays a past flood event over a chosen geographic extent and
period, for the SMMAR (EPTB Aude). Four parts, npm workspaces under `packages/`.

| Part | Where | Role |
|---|---|---|
| Collection scripts | `worker/src/scripts/` | Read the external sources and return what they read; they never store |
| Build and storage | `worker/src/replay/` | Freeze what a replay holds, one file per lane, behind a storage port over PostgreSQL |
| API | `api/` | Express routes that start a build and serve what it stored, through that port and never SQL of its own |
| Interface | `web/` | React, MapLibre and uPlot: a map and a timeline on one clock, talking to the API and to nothing else |

`shared/` holds the Zod contracts, the clock, the configuration and the frozen
reference tables; `migrations/` the schema, numbered SQL files applied one
transaction each. **What decides lives in a pure module**, which is what
`web/tests/` covers.

## Resources

- [`README.md`](README.md) — what the tool is, its sources, how to start it
- [`docs/installation.md`](docs/installation.md) — prerequisites, environment, database, deployment
- [`docs/utilisation.md`](docs/utilisation.md) — the collection scripts and the build, their options and exit codes
- [`docs/api.md`](docs/api.md) — the HTTP routes, their codes, the shape of an error
- [`packages/api/AGENTS.md`](packages/api/AGENTS.md), [`packages/web/AGENTS.md`](packages/web/AGENTS.md) — what each package adds

They describe what exists: what is not written is named as not written.

## Commands

```bash
npm install                 # workspaces, at the root
docker compose up -d db     # PostgreSQL with PostGIS
npm run migrate             # apply the schema
npm run dev:api             # the API
npm run dev:web             # the interface
npm run typecheck && npm run lint && npm run format:check && npm test
```

- **`npm test` needs a database and refuses to start without one.** Nothing
  skips itself, so a green run means the whole suite ran — except under root,
  where four cases that take a permission away skip themselves and say so.
  `npm run test:unit` runs only what needs nothing: a narrower claim, to report
  as such.
- **Never report a check as passing unless you executed it**, and say what you
  could not run.
- **Formatting is `npm run format`, not a rule to follow**, and a size limit is
  an error whose exemption carries its reason on the line above, after `--`.

## The sources

| Source | Holds | Reached by |
|---|---|---|
| Aquasys | Levels, flows, rainfall totals, thresholds, the station referential | REST, authenticated by a token |
| Lizmap | Reference layers, hydraulic structures, extents, camera positions | OGC services |
| Ceneau | Timestamped webcam images | One JSON file per camera, images on another host |
| Radar rainfall | Rainfall accumulation rasters, by delivery | A directory indexed in place, no live history |

- **This repository documents this software, never the systems it reads.** The
  rule this code must follow is written here; what a third party's systems do,
  or fail to enforce, is not — the repository is public, those systems are not.
- **What a source returns beats what its editor documents.** The Aquasys
  OpenAPI specification describes an object response where the API returns
  positional arrays. The recorded responses under `tests/fixtures/` settle it.
- **A script narrows before the per-source calls.** Aquasys has no spatial
  filter, so its referential is loaded whole and filtered in process. Space the
  requests: these are production services.
- **One envelope**, defined in `shared/src/envelope.ts`: `stdout` carries
  `{ data, report }` and nothing else, progress goes to `stderr`. Exit **0** on
  success with `data` possibly empty, **1** when the script could not run, **2**
  when some calls failed. A rule that could not be applied as written goes to
  `report.fallbacks`, never applied in silence.

## The data

Three domain objects — **do not collapse them**:

- **Source** — a producing device or system: station, rain gauge, webcam, radar.
- **Observation** — a raw timestamped datum or medium: level, flow, total, image.
- **Event** (`événement`) — a fact that matters to the analysis: a threshold
  crossed, a road cut, an agent's note. Automatic and manual events share one
  structure, and editing one never alters the observation that produced it.

| French — documentation, UI | English — code |
|---|---|
| `rejeu`, `emprise` | `replay`, `extent` |
| `événement` | `event` |
| `seuil`, `franchissement` | `threshold`, `crossing` |
| `pluviomètre`, `ouvrage` | `rainGauge`, `hydraulicStructure` |
| `lame d'eau`, `livraison` | `radarRainfall`, `delivery` |

Remote identifiers are quoted, never translated: layer names, field names,
product directories, `predictlayers_rejeux/`.

## Invariants

Breaking one produces a wrong result, not merely slower work.

1. **The replay freeze.** Everything is copied when a replay is generated,
   thresholds included. Never resolve data live for a stored replay: thresholds
   are not historised, webcam images expire, and the fleet changes.
2. **One clock.** Normalise every source on import — Aquasys epoch
   milliseconds, Ceneau ISO 8601 UTC, radar epoch seconds in the filename. The
   interface speaks French time, the API UTC: `web/src/time.ts` converts, and
   nothing else builds a date.
3. **Never compute a filename from a target time.** Raster timestamps are
   production times. Index, then match nearest-neighbour within a tolerance
   measured on the images kept; beyond it, draw nothing.
4. **Two data-type tables, never shared.** The same `typeId` is a level on a
   station and a temperature on a rain gauge, and the same `sourceId` names one
   source of each family — hence a key of `(replay, family, id)`. A crossing
   joins the hydro fleet and nothing else.
5. **A replay is named by what stores it**, and its jobs are re-runnable
   without creating duplicates. The database mints the identifier, so none
   collides and none has to be refused.
6. **Configurable, never hardcoded.** Each rests on a value the sources do not
   state: the Aquasys storage timezone, the threshold classification when
   `category` is absent, its business category, and the radar rainfall extent —
   reported with the data, a wrong one shifting the layer invisibly. Make it a
   parameter, surface the fallback, never guess.

The map knows two symbols — a watercourse station is a circle, a hydraulic
structure a square. The charts follow the Acycliq Widget and never embed it:
it is built for live data, where a replay is frozen.

## Rules

- **Language depends on the audience.** UI strings, the documentation and pull
  request descriptions are in French. **Everything in the code is in English** —
  identifiers, filenames, directories, comments — and so are commit messages and
  this file.
- **A comment never restates the code.** Document intent, or a constraint the
  code cannot carry. If the name suffices, write nothing.
- **Every decoding and normalisation rule gets a test on recorded data**, and
  every bug fix a regression test. Threshold classification and time
  normalisation are where a wrong result looks plausible.
- **No test or fixture names a host that resolves.** The reserved `.test` domain
  is what they use, and recorded responses are anonymised — hosts included —
  before they enter the repository.
- **Exchanges use open formats** — REST/JSON, GeoJSON, CSV. Contractual.
- **Keep changes scoped to what was asked.** No adjacent refactor, no
  opportunistic upgrade. Follow an existing pattern before abstracting.
- **Done** means the behaviour works, the tests this file requires exist, the
  relevant checks ran and pass, and you said which ones.
