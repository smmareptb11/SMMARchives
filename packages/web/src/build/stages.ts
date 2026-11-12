import type { JournalEntry, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

/** The strands in the order a reader follows them, the sources first. */
const ORDER = ['aquasys', 'lizmap', 'radar-rainfall', 'events', 'media']

/** What a strand is, in the reader's terms, and what it brings the replay. */
export const STAGES: Record<string, { name: string; brings: string }> = {
  aquasys: {
    name: 'Mesures et seuils',
    brings: 'Les stations, les pluviomètres, leurs mesures et leurs seuils',
  },
  lizmap: { name: 'Webcams', brings: 'Les webcams et leurs images' },
  'radar-rainfall': { name: 'Lames d’eau radar', brings: 'La pluie radar' },
  events: { name: 'Franchissements', brings: 'Les franchissements de seuils' },
  media: { name: 'Images radar', brings: 'La copie des images de la pluie radar' },
}

export type Stage = {
  lane: string
  state: string
  /** What the strand is doing now, when its journal says it in a known way. */
  step: string | undefined
  done: number | undefined
  total: number | undefined
}

type Step = Pick<Stage, 'step' | 'done' | 'total'>

type Lanes = ReplayManifest['lanes']

/** The line that opens a run of `measures n/N`, saying whose measures follow. */
const MEASURES_OF = /^measures of \d+ (hydro|rain-gauge) source\(s\)…$/

/** The lines a build writes as it goes, and what each says in French. */
const STEPS: [RegExp, (counted: string | undefined) => string][] = [
  [/^hydrological stations…$/, () => 'Liste des stations'],
  [/^rain gauges…$/, () => 'Liste des pluviomètres'],
  [/^station details (\d+)\/(\d+)$/, () => 'Fiches des stations'],
  [/^rain gauge details (\d+)\/(\d+)$/, () => 'Fiches des pluviomètres'],
  [/^thresholds (\d+)\/(\d+)$/, () => 'Seuils des stations'],
  [MEASURES_OF, (family) => measuresOf(family)],
  [/^webcam .+…$/, () => 'Recherche des images des webcams'],
  [/^images (\d+)\/(\d+)$/, () => 'Copie des images des webcams'],
  [/^delivery .+…$/, () => 'Lecture des livraisons radar'],
  [/^media (\d+)\/(\d+)$/, () => 'Copie des images radar'],
]

const measuresOf = (family: string | undefined) =>
  family === 'rain-gauge' ? 'Mesures des pluviomètres' : 'Mesures des stations'

/**
 * Where each strand of a build stands, read from its journal.
 *
 * Read from the text the worker writes, which is all the journal carries: a
 * line it does not recognise leaves the strand at its state alone, so a change
 * of wording on the worker's side costs the detail, never the screen.
 *
 * While the build runs, the strands not started yet are there too, waiting:
 * a manifest lists a strand once it starts, and a count of what is left that
 * grew as the build went would read as going backwards.
 */
export function stagesOf(
  lanes: Lanes,
  journal: readonly JournalEntry[],
  running: boolean,
): Stage[] {
  const states = new Map<string, string>(running ? ORDER.map((lane) => [lane, 'pending']) : [])
  for (const [lane, status] of Object.entries(lanes)) states.set(lane, status.state)

  return [...states]
    .sort(([one], [other]) => rank(one) - rank(other) || one.localeCompare(other))
    .map(([lane, state]) => ({
      lane,
      state,
      ...lastStep(journal.filter((one) => one.lane === lane && one.kind === 'progress')),
    }))
}

function rank(lane: string): number {
  const at = ORDER.indexOf(lane)
  return at === -1 ? ORDER.length : at
}

/** The last thing a strand said it was doing, and how far along. */
function lastStep(lines: readonly JournalEntry[]): Step {
  let step: Step = { step: undefined, done: undefined, total: undefined }
  // `measures n/N` does not say whose: the header before it does.
  let family: string | undefined

  for (const line of lines) {
    const said = (line.message ?? '').trim()
    family = MEASURES_OF.exec(said)?.[1] ?? family
    step = readLine(said, family) ?? step
  }
  return step
}

/** What one line says the strand is doing, or nothing for a line not known. */
function readLine(said: string, family: string | undefined): Step | undefined {
  const counted = /^measures (\d+)\/(\d+)$/.exec(said)
  if (counted !== null) {
    return { step: measuresOf(family), done: Number(counted[1]), total: Number(counted[2]) }
  }
  for (const [pattern, name] of STEPS) {
    const match = pattern.exec(said)
    if (match === null) continue
    const total = match[2] === undefined ? undefined : Number(match[2])
    return { step: name(match[1]), done: total === undefined ? undefined : Number(match[1]), total }
  }
  return undefined
}

/** How many strands are over, out of all of them. */
export function settled(stages: readonly Stage[]): { over: number; of: number } {
  return {
    over: stages.filter((one) => one.state === 'done' || one.state === 'failed').length,
    of: stages.length,
  }
}
