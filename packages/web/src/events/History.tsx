import {
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'

import type { Station } from '@smmarchives/shared/contracts/station.ts'

import { api } from '../api.ts'
import { PointerContext, pointedOf, pointingAt } from '../map/pointed.ts'
import { formatInstant } from '../time.ts'
import { ASSUMED_NATURE } from '../tracks/crossing.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { historyAt, inkOn, type HistoryEntry } from './history.ts'

/** How near the foot of the list counts as being there, in pixels. */
const AT_THE_FOOT = 30

export type HistoryProps = {
  /** Where reporting starts, in the heading. */
  action: ReactNode
  content: ReplayContent
  replayId: string
  /** The instant read, as epoch milliseconds. */
  at: number
  playing: boolean
  onOpen: (entry: HistoryEntry) => void
}

/**
 * What had happened by the instant read, beside the map: the crossings and what
 * agents reported, oldest first. The form opens in its place.
 */
export function History({ action, content, replayId, at, playing, onOpen }: HistoryProps) {
  const entries = useMemo(
    () => historyAt(content.events, content.stations, at),
    [content.events, content.stations, at],
  )
  const list = useFollow(entries.length, playing)

  return (
    <aside className="history">
      <header>
        <div>
          <h2>Événements et témoignages</h2>
          <p className="count">
            {entries.length} entrée{entries.length > 1 ? 's' : ''}
          </p>
        </div>
        {action}
      </header>
      <ol className="feed" {...list}>
        {entries.length === 0 ? (
          <li className="note">Aucun événement avant cet instant.</li>
        ) : (
          entries.map((entry) => (
            <li key={entry.id}>
              <Card entry={entry} stations={content.stations} replayId={replayId} onOpen={onOpen} />
            </li>
          ))
        )}
      </ol>
    </aside>
  )
}

/**
 * The list kept at its foot as entries arrive, while the reading plays or the
 * reader was already there — and left where it is when they scrolled up to read.
 */
function useFollow(count: number, playing: boolean) {
  const list = useRef<HTMLOListElement>(null)
  // Noted as the reader scrolls, so it is the place they chose, and not the
  // one the new entries push them to.
  const atTheFoot = useRef(true)
  const onScroll = () => {
    const held = list.current
    if (held !== null) {
      atTheFoot.current = held.scrollTop + held.clientHeight >= held.scrollHeight - AT_THE_FOOT
    }
  }

  useLayoutEffect(() => {
    const held = list.current
    if (held !== null && (playing || atTheFoot.current)) held.scrollTop = held.scrollHeight
  }, [count, playing])

  return { ref: list, onScroll }
}

/** A crossing's threshold, on its colour; the sort of what an agent reported. */
function Badge({ entry }: { entry: HistoryEntry }) {
  const { label, colour } = entry.badge
  if (colour === undefined) return <span className="badge kind">{label}</span>

  return (
    <span
      className={entry.assumed ? 'badge level assumed' : 'badge level'}
      style={{ background: colour, color: inkOn(colour) }}
    >
      {label}
    </span>
  )
}

/** One event: when, what kind, what, by whom, and a report's photo beside it. */
function Card({
  entry,
  stations,
  replayId,
  onOpen,
}: {
  entry: HistoryEntry
  stations: readonly Station[]
  replayId: string
  onOpen: (entry: HistoryEntry) => void
}) {
  const pointer = useContext(PointerContext)
  const colour = entry.badge.colour
  const classes = ['card', entry.kind, entry.latest ? 'latest' : '', entry.over ? 'over' : '']

  return (
    <button
      type="button"
      className={classes.join(' ').trim()}
      style={colour === undefined ? undefined : ({ '--c': colour } as CSSProperties)}
      {...pointingAt(pointer, pointedOf(entry, stations))}
      onClick={() => {
        onOpen(entry)
      }}
    >
      <span className="body">
        <span className="meta">
          <span className="badge time">{formatInstant(entry.from)}</span>
          <Badge entry={entry} />
        </span>
        <span className="title">{entry.title}</span>
        {entry.description === undefined ? null : <span className="text">{entry.description}</span>}
        <span className="who">{entry.who}</span>
        {entry.assumed ? <span className="who">{ASSUMED_NATURE}</span> : null}
      </span>
      {/* Small beside the words: the sheet the card opens shows it whole. */}
      {entry.photo === undefined ? null : (
        <img className="thumb" src={api.mediaUrl(replayId, entry.photo)} alt="" loading="lazy" />
      )}
    </button>
  )
}
