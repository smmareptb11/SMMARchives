import type {
  JournalEntry,
  LaneName,
  ReplayManifest,
} from '@smmarchives/shared/contracts/replay.ts'

import { useLayoutEffect, useRef } from 'react'

import { formatInstant, formatPeriod } from '../time.ts'
import { LaneFailure } from './LaneFailure.tsx'
import { LANE_LABEL } from './lanes.ts'
import { isAtEnd } from './progress.ts'
import { settled, STAGES, stagesOf, type Stage } from './stages.ts'

const STATE_SAID: Record<string, string> = {
  pending: 'En attente',
  running: 'En cours',
  done: 'Terminée',
  failed: 'En échec',
}

export type BuildScreenProps = {
  manifest: ReplayManifest
  journal: readonly JournalEntry[]
}

/** What a construction is doing, while it does it, in the reader's terms. */
export function BuildScreen({ manifest, journal }: BuildScreenProps) {
  const stages = stagesOf(manifest.lanes, journal, manifest.state === 'running')
  const { over, of } = settled(stages)
  const media = manifest.media

  return (
    <section className="build">
      <h1>{manifest.label ?? 'Rejeu sans titre'}</h1>
      <p className="lead">{formatPeriod(manifest.period)}</p>
      <p>
        <strong>
          {manifest.state === 'running' ? 'Construction en cours' : 'Construction terminée'}
        </strong>{' '}
        : {over} étape{over > 1 ? 's' : ''} sur {of} terminée{over > 1 ? 's' : ''}.
      </p>

      <ol className="stages">
        {stages.map((stage) => (
          <StageCard
            key={stage.lane}
            stage={stage}
            error={manifest.lanes[stage.lane as LaneName]?.error}
          />
        ))}
      </ol>

      <p className="note">
        Images copiées : {media.copied}, en échec : {media.failed}.
      </p>

      <Journal journal={journal} />
    </section>
  )
}

function StageCard({ stage, error }: { stage: Stage; error: string | undefined }) {
  const named = STAGES[stage.lane] ?? { name: LANE_LABEL[stage.lane] ?? stage.lane, brings: '' }

  return (
    <li className="stage" data-state={stage.state}>
      <div className="stage-head">
        <strong>{named.name}</strong>
        <span className="stage-state">{STATE_SAID[stage.state] ?? stage.state}</span>
      </div>
      {named.brings === '' ? null : <p className="note">{named.brings}</p>}
      {stage.state === 'running' ? <StepNow stage={stage} /> : null}
      {stage.state === 'failed' ? (
        <LaneFailure lane={stage.lane} state={stage.state} error={error} />
      ) : null}
    </li>
  )
}

/** What a running strand is doing, with how far along when it says. */
function StepNow({ stage }: { stage: Stage }) {
  if (stage.step === undefined) return null

  return (
    <p className="stage-step">
      {stage.step}
      {stage.total === undefined ? null : (
        <>
          {' '}
          <span className="count">
            {stage.done}/{stage.total}
          </span>
          <progress value={stage.done} max={stage.total} />
        </>
      )}
    </p>
  )
}

/** Every line the build wrote, folded: there for whoever has to repair. */
function Journal({ journal }: { journal: readonly JournalEntry[] }) {
  const { box, onScroll, onOpen } = useFollowedTail(journal)

  return (
    <details className="build-journal" onToggle={onOpen}>
      <summary>Journal détaillé ({journal.length} lignes)</summary>
      <ol className="journal" ref={box} onScroll={onScroll}>
        {journal.map((one) => (
          <li key={`${one.at}-${one.lane}-${one.kind}`}>
            <time>{formatInstant(one.at)}</time> {LANE_LABEL[one.lane] ?? one.lane} :{' '}
            {one.message ?? one.kind}
          </li>
        ))}
      </ol>
    </details>
  )
}

/**
 * The journal kept on its last line as lines arrive, for as long as the reader
 * is there: on the bottom when the screen opens, and again whenever they scroll
 * back down to it. Scrolled up, they are left where they are reading.
 *
 * On the list itself and not on its length: past the lines the screen keeps,
 * a new line pushes the first one out and the length no longer moves.
 */
function useFollowedTail(journal: readonly JournalEntry[]) {
  const box = useRef<HTMLOListElement>(null)
  const following = useRef(true)

  useLayoutEffect(() => {
    const list = box.current
    if (list !== null && following.current) list.scrollTop = list.scrollHeight
  }, [journal])

  const onScroll = () => {
    if (box.current !== null) following.current = isAtEnd(box.current)
  }

  // Folded, the list has no height to scroll: opened, it starts on its end.
  const onOpen = () => {
    const list = box.current
    if (list === null) return
    list.scrollTop = list.scrollHeight
    following.current = true
  }

  return { box, onScroll, onOpen }
}
