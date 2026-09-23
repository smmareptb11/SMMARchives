import { memo, type MouseEvent as ReactMouseEvent } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { formatHour, formatInstant } from '../time.ts'
import { cursorAt, instantAt } from '../transport/reading.ts'
import { Lane } from './Lane.tsx'
import { MUTES } from '../mutes.ts'
import { assumedCrossings, speaking, type Family, type ReplayContent } from './lanes.ts'

export type TrackListProps = {
  manifest: ReplayManifest
  /** What the replay holds, already laid out: `ReplayScreen` builds them once. */
  families: readonly Family[]
  /** Where the reader pointed, as a fraction of the period. */
  onSeek: (fraction: number) => void
  /** Whether the lanes with nothing on them are asked for. */
  mutesShown: boolean
}

/**
 * What a replay brought back, one lane per source.
 *
 * It knows nothing of the cursor, and takes no prop that moves with it: three
 * hundred lanes rebuilt sixty times a second would make the reading stutter,
 * and not one of them changes as the cursor advances. The reading bar is drawn
 * beside it, by something that does move.
 */
export const TrackList = memo(function TrackList({
  manifest,
  families,
  onSeek,
  mutesShown,
}: TrackListProps) {
  return (
    <section>
      <Ruler period={manifest.period} onSeek={onSeek} />

      {families.map((family) => (
        <FamilyLanes
          key={family.id}
          family={family}
          replayId={manifest.id}
          mutesShown={mutesShown}
        />
      ))}

      <LanesThatFailed manifest={manifest} />
    </section>
  )
})

/** One family, with the lanes the reader asked for and a count of the others. */
function FamilyLanes({
  family,
  replayId,
  mutesShown,
}: {
  family: Family
  replayId: string
  mutesShown: boolean
}) {
  const lanes = mutesShown ? family.lanes : speaking(family)
  const held = family.lanes.length - lanes.length

  return (
    <details open>
      <summary>
        {family.label} <span className="count">{lanes.length}</span>
      </summary>
      {family.silent === undefined ? null : <p className="note">{silenceOf(family.silent)}</p>}
      {held === 0 ? null : <p className="note">{heldSaid(family, held)}</p>}
      {lanes.map((lane) => (
        <Lane key={lane.id} lane={lane} replayId={replayId} />
      ))}
    </details>
  )
}

/**
 * What a replay is called, over what period, and what it had to guess.
 *
 * Apart from the lanes because the reading bar is laid over those and not over
 * this: a bar crossing the title would say the title happened at that instant.
 */
export function ReplayHeading({
  manifest,
  content,
}: {
  manifest: ReplayManifest
  content: ReplayContent
}) {
  return (
    <>
      <h1>{manifest.label ?? 'Rejeu sans titre'}</h1>
      <p className="lead">
        Du {formatInstant(manifest.period.from)} au {formatInstant(manifest.period.to)} — heure
        française.
      </p>
      <Assumed crossings={assumedCrossings(content)} total={content.events.length} />
    </>
  )
}

/**
 * What the replay guessed, said before anything rests on it.
 *
 * Aquasys gives part of its fleet a ladder with neither `category` nor
 * `isOverrunThreshold`: the nature is then assumed from the label, and a
 * drought ladder read as an alert one fires on an ordinary flow. The segments
 * concerned are hatched; this says how many there are.
 */
function Assumed({ crossings, total }: { crossings: number; total: number }) {
  if (crossings === 0) return null

  return (
    <p className="note assumed-note">
      {crossings} franchissement{plural(crossings)} sur {total} repose
      {crossings > 1 ? 'nt' : ''} sur un seuil dont la nature a été supposée, faute de la lire dans
      la source. Ces segments sont hachurés.
    </p>
  )
}

const plural = (count: number) => (count > 1 ? 's' : '')

/**
 * What a family holds when it holds no lane at all.
 *
 * One family can reach this: the rain gauges of a replay that collected no
 * measure. Every other source of this screen gets a lane whether it has
 * anything on it or not, and the switch is what decides whether it is drawn.
 */
function silenceOf(count: number): string {
  return `${String(count)} pluviomètre${plural(count)} dans ce rejeu, sans piste : il ne porte aucune mesure de pluie.`
}

/** Why a whole family of cameras can hold nothing, which the reader will ask. */
const RETENTION =
  "Ceneau ne garde une image qu'un mois, et le rapport de collecte dit si la période est plus ancienne."

/**
 * What the switch is holding back here, and where to go to see it.
 *
 * Counted rather than simply gone: a family showing three lanes out of
 * ninety-four would otherwise read as a replay of three sources. The switch is
 * up in the map's panel, far from what it acts on, so the sentence names it —
 * by the name the panel gives it, which `mutes.ts` spells once for both.
 */
function heldSaid(family: Family, count: number): string {
  const said =
    `${String(count)} piste${plural(count)} masquée${plural(count)} : rien à montrer sur la ` +
    `période. Case « ${MUTES} » pour les afficher.`

  return family.id === 'webcam' && count === family.lanes.length ? `${said} ${RETENTION}` : said
}

const TICKS = 8

/**
 * The hours of the period, in French time, and where one seeks.
 *
 * The ruler is what a reader points at to move in time, so it is what listens:
 * a bar thin enough to be a bar is too thin to aim at, and the lanes below say
 * what happened rather than when one is looking.
 */
function Ruler({ period, onSeek }: { period: TimeWindow; onSeek: (fraction: number) => void }) {
  const seekFrom = (event: ReactMouseEvent<HTMLDivElement>) => {
    const track = event.currentTarget.getBoundingClientRect()
    onSeek((event.clientX - track.left) / track.width)
  }

  return (
    <div className="lane ruler">
      <div className="lane-label">Sources</div>
      {/*
        No `slider` role and no tab stop. The role promises a value and keyboard
        handling this element cannot give: it is memoised away from the cursor
        on purpose, so it does not know where the reading is. And a tab stop
        here would silence the arrows, which `Transport` binds on the document
        and only for what has no focus of its own.
      */}
      <div
        className="lane-track"
        onMouseDown={seekFrom}
        onMouseMove={(event) => {
          // Held down, so dragging scrubs; a plain move would seek on hover.
          if (event.buttons === 1) seekFrom(event)
        }}
      >
        {Array.from({ length: TICKS }, (_, index) => {
          const at = instantAt(cursorAt(period, index / TICKS))
          return (
            <span className="tick" key={at} style={{ left: `${String((index / TICKS) * 100)}%` }}>
              {formatHour(at)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** A lane that did not run is said, rather than left as an absence. */
function LanesThatFailed({ manifest }: { manifest: ReplayManifest }) {
  const failed = Object.entries(manifest.lanes).filter(([, lane]) => lane.state !== 'done')
  if (failed.length === 0) return null

  return (
    <p className="refusal">
      Ce rejeu est incomplet.
      <ul>
        {failed.map(([name, lane]) => (
          <li key={name}>
            {name} : {lane.error ?? lane.state}
          </li>
        ))}
      </ul>
    </p>
  )
}
