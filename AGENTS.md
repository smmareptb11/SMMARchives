# AGENTS.md

Instructions for AI coding agents: what the repository does not say by itself.
The README and `docs/` describe the software for whoever installs, runs and
calls it.

## The project

SMMARchives replays a past flood event over a chosen extent and period, for the
SMMAR (EPTB Aude). Four parts, npm workspaces under `packages/`:

| Part | Where | Role |
|---|---|---|
| Source readers | `worker/src/sources/` | Read the external sources and return what they read; they never store |
| Build and storage | `worker/src/replay/`, `worker/src/scripts/` | Freeze what a replay holds, behind a storage port over PostgreSQL; `build:replay` and `migrate` are the commands |
| API | `api/` | Express routes that start a build and serve what it stored, through that port and never SQL of their own |
| Interface | `web/` | React, MapLibre and uPlot: a map and a timeline on one clock, talking to the API and to nothing else |

`shared/` holds the Zod contracts, the clock, the configuration and the frozen
reference tables. **What decides lives in a pure module**, and that is what the
tests cover; the React components are not tested.

## Commands and checks

```bash
npm install                 # workspaces, at the root
docker compose up -d db     # PostgreSQL with PostGIS
npm run migrate             # apply the schema
npm run dev:api
npm run dev:web
npm run typecheck && npm run lint && npm run format:check && npm test
```

- **`npm test` needs a database and refuses to start without one.** Nothing
  skips itself, except under root, where the cases that take a permission away
  skip themselves and say so. `npm run test:unit` runs only what needs nothing:
  a narrower claim, to report as such.
- **Never report a check as passing unless you ran it**, and say what you could
  not run.
- **Formatting is `npm run format`**, not a rule to follow by hand. A size limit
  is an error whose exemption carries its reason on the line above, after `--`.

## The sources

| Source | Holds | Reached by |
|---|---|---|
| Aquasys | Levels, flows, rainfall totals, thresholds, the station referential | REST, with a token |
| Lizmap | Camera positions | OGC services |
| Ceneau | Timestamped webcam images | One JSON file per camera, images on another host |
| Radar rainfall | Rainfall accumulation rasters, by delivery | A directory indexed in place, no live history |

- **This repository documents this software, never the systems it reads.** It
  is public; they are not.
- **What a source returns beats what its editor documents.** The Aquasys
  OpenAPI specification describes objects where the API returns positional
  arrays: the recorded responses under `tests/fixtures/` settle it.
- **The build narrows before the per-source calls.** Aquasys has no spatial
  filter: its referential is loaded whole and filtered in process.
- **One envelope**, defined in `shared/src/envelope.ts`: each data set is stored
  as `{ data, report }`, checked against its contract before it is written. The
  build exits **0** when the replay is complete, **2** when it is partial or
  failed, **1** when it could not run, and writes nothing on `stdout`. A rule
  that could not be applied as written goes to `report.fallbacks`, never in
  silence.

## The data

Three domain objects — **do not collapse them**:

- **Source** — a producing device or system: station, rain gauge, webcam, radar.
- **Observation** — a raw timestamped datum: level, flow, total, image.
- **Event** — a fact that matters to the analysis: a threshold crossed, a road
  cut, an agent's note. Automatic and reported events share one structure, and
  editing one never alters the observation that produced it.

| French — documentation, interface | English — code |
|---|---|
| rejeu, emprise | `replay`, `extent` |
| événement | `event` |
| seuil, franchissement | `threshold`, `crossing` |
| pluviomètre, ouvrage | `rainGauge`, `hydraulicStructure` |
| lame d'eau, livraison | `radarRainfall`, `delivery` |

Remote identifiers are quoted as they are, never translated: layer names, field
names, product directories.

## Invariants

Breaking one produces a wrong result, not merely slower work.

1. **The replay freeze.** Everything is copied when a replay is built,
   thresholds included. Never read a source live for a stored replay: thresholds
   are not historised, images expire, the fleet changes.
2. **One clock.** Every source is normalised on import — Aquasys epoch
   milliseconds, Ceneau ISO 8601 UTC, radar epoch seconds in the file name. The
   interface speaks French time, the API UTC: `web/src/time.ts` converts, and
   nothing else builds a date.
3. **Never compute a radar file name from a target time.** Timestamps are
   production times: index, then match the nearest within a tolerance measured
   on the images kept; beyond it, draw nothing.
4. **Two data-type tables, never shared.** The same `typeId` is a level on a
   station and a temperature on a rain gauge, and the same `sourceId` names one
   source of each family — hence a key of `(replay, family, id)`. A crossing
   concerns the hydrometric fleet alone.
5. **A replay is named by what stores it**, and built once. The database mints
   the identifier; a build never goes into a replay another build has started.
6. **Configurable, never hardcoded**, for whatever the sources do not state: the
   classification of a threshold without `category`, the business category of a
   station, the radar rainfall extent. Make it a parameter, surface the
   fallback, never guess.

On the map, a watercourse station is a circle, a hydraulic structure a square, a
rain gauge a triangle, and a reported event a diamond, or the area it covers.
The charts follow the Acycliq Widget without embedding it: it is built for live
data, where a replay is frozen.

## API

- **An error body returns only what a schema accepted**: a replay identifier or
  a data set name. Never a media path, a name the client invented, the standard
  error of a child process, or the message of an error we did not raise
  ourselves; the rest goes to the log. The rule is written on `sendProblem`, the
  one passage every error body takes, and nothing checks it automatically.
- **No test starts a real collection.** The build launcher is injectable
  (`ApiOptions.launch`), and the tests' `appOn` helper imposes one that launches
  nothing. Mounting a test application without it puts back the real
  `spawnBuild`, on the real repository and its `.env`.
- **`docs/api.md` states what the API promises**: a guarantee is verified before
  it is written there.

## Interface

- **`react-hooks/exhaustive-deps` is an error.** A hook watching the wrong value
  produces no wrong result: it redraws at the wrong moment, or reads a value
  from a frame that is gone. A deliberate omission carries its reason after
  `--`, and is one of three kinds: a memoised member of an object rebuilt on
  every render; the fields read rather than the record holding them; a value
  read once to draw a first frame. The three in `ReplayScreen.tsx`,
  `useReplayContent.ts` and `detail/StationChart.tsx` show the form.

## Rules

- **Language depends on the audience.** The interface, the documentation and
  pull request descriptions are in French. **Everything in the code is in
  English** — identifiers, files, directories, comments — and so are commit
  messages and this file.
- **Every decoding and normalisation rule gets a test on recorded data**, and
  every bug fix a regression test. Threshold classification and time
  normalisation are where a wrong result looks plausible.
- **No test or fixture names a host that resolves.** They use the reserved
  `.test` domain, and recorded responses are anonymised, hosts included, before
  they enter the repository.
- **Exchanges use open formats** — REST/JSON, GeoJSON, CSV. Contractual.
- **Done** means the behaviour works, the tests this file requires exist, the
  relevant checks ran and pass, and you said which ones.
