import {
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'

import { api } from '../api.ts'
import type { Named } from '../map/frame.ts'
import { PointerContext, pointingAt } from '../map/pointed.ts'
import { formatInstant } from '../time.ts'
import { drawnMarks, emptyOf, type Lane as LaneModel, type Mark } from './lanes.ts'
import { fractionAt } from './pointer.ts'

/**
 * How far apart two marks must sit to both be drawn, in percent of the lane.
 *
 * About sixty pixels on a lane a thousand wide: enough for a thumbnail to be
 * a thumbnail. A replay of 24 hours holds 1 537 webcam images, and drawing
 * them all would fetch 1 537 files to render a smear.
 */
const MIN_GAP = 6

/** How wide the full image is shown, and how far it keeps from the edges. */
const PREVIEW_WIDTH = 480
const PREVIEW_MARGIN = 8

/**
 * How long the pointer rests on a view before its full image is fetched.
 *
 * Sweeping across a lane crosses every frame on the way, and opening each one
 * would fetch seventeen images of six hundred kilobytes for a gesture nobody
 * meant as a request. Short enough to feel immediate on the frame one stops at.
 */
const RESTING_MS = 150

export type LaneProps = {
  lane: LaneModel
  /** The mark of its family, before its name. */
  glyph?: ReactNode
  replayId: string
  /** Opens what an agent reported, from the mark that stands for it. */
  onOpenReport: (id: string) => void
  /** Moves the reading to where the lane was clicked, as a fraction of the period. */
  onSeek: (fraction: number) => void
  /** Opens the detail of what a lane's name stands for: a source, or a camera. */
  onOpenLane: (named: Named) => void
}

/** The full image behind a frame, and the style that pins it where it belongs. */
type Preview = {
  src: string
  caption: string
  style: CSSProperties
}

export function Lane({ lane, glyph, replayId, onOpenReport, onSeek, onOpenLane }: LaneProps) {
  const marks = drawnMarks(lane, MIN_GAP)
  const { preview, onPreview } = usePreview()
  const pointer = useContext(PointerContext)

  return (
    <div
      className={classOfLane(lane)}
      style={lane.rows === undefined ? undefined : ({ '--rows': lane.rows } as CSSProperties)}
      {...pointingAt(pointer, lane.pointed)}
    >
      <div className="lane-label" title={lane.label}>
        <LaneName lane={lane} glyph={glyph} onOpenLane={onOpenLane} />
      </div>
      {/* A click anywhere along it reads that instant, as on the ruler. No tab
          stop, for the same reason as the ruler: the arrows move the reading. */}
      <div
        className="lane-track"
        onClick={(event) => {
          onSeek(fractionAt(event))
        }}
      >
        {/* Keyed on their place in the lane, which their order keeps: two
            crossings of one station can begin on the same instant. */}
        {marks.map((mark, index) =>
          mark.report === undefined ? (
            <LaneMark
              key={`${lane.id}-${String(index)}`}
              mark={mark}
              caption={captionOf(lane.label, mark)}
              replayId={replayId}
              onPreview={onPreview}
            />
          ) : (
            <ReportMark
              key={mark.report}
              mark={mark}
              caption={captionOf(lane.label, mark)}
              onOpen={onOpenReport}
            />
          ),
        )}
        <Empty lane={lane} />
      </div>
      {preview === undefined ? null : <FullImage preview={preview} />}
    </div>
  )
}

/**
 * The full image a frame opens, once the pointer has rested on it.
 *
 * One timer for the lane, since one preview is open at a time: entering a
 * frame cancels whatever the frame before it had started.
 */
function usePreview(): {
  preview: Preview | undefined
  onPreview: (next: Preview | undefined) => void
} {
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const resting = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      window.clearTimeout(resting.current)
    },
    [],
  )

  const onPreview = (next: Preview | undefined) => {
    window.clearTimeout(resting.current)
    if (next === undefined) setPreview(undefined)
    else resting.current = window.setTimeout(() => setPreview(next), RESTING_MS)
  }
  return { preview, onPreview }
}

type LaneMarkProps = {
  mark: Mark
  caption: string
  replayId: string
  onPreview: (preview: Preview | undefined) => void
}

function LaneMark({ mark, caption, replayId, onPreview }: LaneMarkProps) {
  const full = mark.full

  return (
    <span
      className={classOf(mark)}
      style={{
        left: `${String(mark.left)}%`,
        width: `${String(mark.width)}%`,
        ...(mark.height === undefined ? {} : { height: `${String(mark.height)}%` }),
        // `backgroundColor`, never the `background` shorthand: it would wipe
        // the hatching the stylesheet puts on an assumed crossing.
        ...(mark.color === undefined ? {} : { backgroundColor: mark.color }),
      }}
      // A frame says what it is through the image it opens; a second, native
      // tooltip over that image would only fight with it. Where the image is
      // pinned is read here and not on the timer, because React clears
      // `currentTarget` the moment the handler returns.
      {...(full === undefined
        ? { title: caption }
        : {
            onMouseEnter: (event: MouseEvent<HTMLElement>) => {
              onPreview(
                pinnedTo(event.currentTarget, { src: api.mediaUrl(replayId, full), caption }),
              )
            },
            onMouseLeave: () => {
              onPreview(undefined)
            },
          })}
    >
      {mark.path === undefined ? null : (
        <img src={api.mediaUrl(replayId, mark.path)} alt={caption} loading="lazy" />
      )}
    </span>
  )
}

/** What an empty lane says, a gap in the data set apart from a finding. */
function Empty({ lane }: { lane: LaneModel }) {
  const empty = emptyOf(lane)
  if (empty === undefined) return null
  return <span className={empty.gap ? 'empty gap' : 'empty'}>{empty.said}</span>
}

/**
 * A lane's name, and the way to the detail of what it stands for, as a click on
 * its symbol or its frame on the map opens it.
 */
function LaneName({
  lane,
  glyph,
  onOpenLane,
}: {
  lane: LaneModel
  glyph: ReactNode
  onOpenLane: (named: Named) => void
}) {
  const pointed = lane.pointed
  if (pointed === undefined || 'report' in pointed) {
    return (
      <>
        {glyph}
        {lane.label}
      </>
    )
  }

  return (
    <button
      type="button"
      className="lane-name"
      onClick={() => {
        onOpenLane(pointed)
      }}
    >
      {glyph}
      {lane.label}
    </button>
  )
}

/**
 * What an agent reported, as a mark one clicks to read it.
 *
 * A button, so the keyboard reaches it as the pointer does. On the row
 * `lanes.ts` gave it, which is what keeps two reports of one instant apart.
 */
function ReportMark({
  mark,
  caption,
  onOpen,
}: {
  mark: Mark
  caption: string
  onOpen: (id: string) => void
}) {
  const id = mark.report
  const pointer = useContext(PointerContext)
  if (id === undefined) return null

  return (
    <button
      type="button"
      className="mark report"
      {...pointingAt(pointer, { report: id })}
      title={caption}
      aria-label={caption}
      style={
        {
          left: `${String(mark.left)}%`,
          width: `${String(mark.width)}%`,
          '--row': mark.row ?? 0,
        } as CSSProperties
      }
      onClick={(event) => {
        // Not up to the lane: the sheet it opens brings the reading to the
        // event, and a second seek to the spot clicked would race it.
        event.stopPropagation()
        onOpen(id)
      }}
    />
  )
}

/**
 * Mounted on hover and not before, which is the whole of the lazy load: a full
 * image weighs some six hundred kilobytes against four for the reduction the
 * lane draws, and a lane holds up to seventeen of them.
 */
function FullImage({ preview }: { preview: Preview }) {
  return (
    <figure className="preview" style={preview.style}>
      <img src={preview.src} alt={preview.caption} />
      <figcaption>{preview.caption}</figcaption>
    </figure>
  )
}

function classOfLane(lane: LaneModel): string {
  return [
    'lane',
    lane.filmstrip === true ? 'film' : '',
    lane.bars === true ? 'bars' : '',
    lane.rows === undefined ? '' : 'stacked',
  ]
    .filter(Boolean)
    .join(' ')
}

function classOf(mark: Mark): string {
  return [
    mark.path === undefined ? 'mark' : 'frame',
    mark.assumed === true ? 'assumed' : '',
    mark.instant === true ? 'instant' : '',
    mark.seam === true ? 'seam' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function captionOf(label: string, mark: Mark): string {
  if (mark.caption !== undefined) return mark.caption
  return [label, formatInstant(mark.at), mark.label].filter(Boolean).join(' · ')
}

/**
 * Places the full image beside the frame it belongs to, inside the window.
 *
 * Under the frame when the frame sits in the upper half of the window, over it
 * otherwise, and always pinned by the edge nearest the frame — so the image
 * arriving grows the box away from what one is pointing at rather than under
 * it. The stylesheet holds the box's shape before the image loads, or the
 * caption would jump the moment it does.
 */
function pinnedTo(frame: HTMLElement, of: { src: string; caption: string }): Preview {
  const rect = frame.getBoundingClientRect()
  const width = Math.min(PREVIEW_WIDTH, window.innerWidth - 2 * PREVIEW_MARGIN)
  const below = rect.top < window.innerHeight / 2

  return {
    ...of,
    style: {
      width: `${String(width)}px`,
      left: `${String(Math.min(Math.max(rect.left, PREVIEW_MARGIN), window.innerWidth - width - PREVIEW_MARGIN))}px`,
      top: `${String(below ? rect.bottom + PREVIEW_MARGIN : rect.top - PREVIEW_MARGIN)}px`,
      ...(below ? {} : { transform: 'translateY(-100%)' }),
    },
  }
}
