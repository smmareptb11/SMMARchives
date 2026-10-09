import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'

import { api } from '../api.ts'
import { formatInstant } from '../time.ts'
import { drawnMarks, type Lane as LaneModel, type Mark } from './lanes.ts'

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
  replayId: string
  /** What a mark drawing an agent's event opens. */
  onOpenEvent?: ((id: string) => void) | undefined
}

/** The full image behind a frame, and the style that pins it where it belongs. */
type Preview = {
  src: string
  caption: string
  style: CSSProperties
}

export function Lane({ lane, replayId, onOpenEvent }: LaneProps) {
  const rows = lane.rows ?? 1
  const marks = drawnMarks(lane, MIN_GAP)
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const resting = useRef<number | undefined>(undefined)

  // One timer for the lane, since one preview is open at a time: entering a
  // frame cancels whatever the frame before it had started.
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

  return (
    <div className={laneClassOf(lane)}>
      <div className="lane-label" title={lane.label}>
        {lane.label}
      </div>
      <div
        className="lane-track"
        style={rows > 1 ? ({ '--rows': String(rows) } as CSSProperties) : undefined}
      >
        {marks.map((mark) => (
          <LaneMark
            key={`${lane.id}-${mark.event ?? mark.at}`}
            mark={mark}
            caption={captionOf(lane.label, mark)}
            replayId={replayId}
            onPreview={onPreview}
            onOpenEvent={onOpenEvent}
          />
        ))}
        {lane.marks.length === 0 ? <span className="empty">rien à cette période</span> : null}
      </div>
      {preview === undefined ? null : <FullImage preview={preview} />}
    </div>
  )
}

type LaneMarkProps = {
  mark: Mark
  caption: string
  replayId: string
  onPreview: (preview: Preview | undefined) => void
  onOpenEvent?: ((id: string) => void) | undefined
}

function LaneMark({ mark, caption, replayId, onPreview, onOpenEvent }: LaneMarkProps) {
  const full = mark.full
  const opens = opening(mark.event, onOpenEvent)

  return (
    <span
      className={classOf(mark)}
      style={{
        left: `${String(mark.left)}%`,
        width: `${String(mark.width)}%`,
        ...(mark.height === undefined ? {} : { height: `${String(mark.height)}%` }),
        ...(mark.row === undefined ? {} : { '--row': String(mark.row) }),
        // `backgroundColor`, never the `background` shorthand: it would wipe
        // the hatching the stylesheet puts on an assumed crossing.
        ...(mark.color === undefined ? {} : { backgroundColor: mark.color }),
      }}
      // A frame says what it is through the image it opens; a second, native
      // tooltip over that image would only fight with it. Where the image is
      // pinned is read here and not on the timer, because React clears
      // `currentTarget` the moment the handler returns.
      {...opens}
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

/**
 * What makes a mark answer a click and a key, when it draws an agent's event.
 *
 * A button by its role rather than its element: the mark is placed and sized
 * like every other, and a `button` brings the form's own padding with it.
 */
function opening(event: string | undefined, open: ((id: string) => void) | undefined) {
  if (event === undefined || open === undefined) return {}

  return {
    role: 'button',
    tabIndex: 0,
    onClick: () => {
      open(event)
    },
    onKeyDown: (key: KeyboardEvent<HTMLElement>) => {
      if (key.key !== 'Enter' && key.key !== ' ') return
      key.preventDefault()
      open(event)
    },
  }
}

function laneClassOf(lane: LaneModel): string {
  return [
    'lane',
    lane.filmstrip === true ? 'film' : '',
    lane.bars === true ? 'bars' : '',
    (lane.rows ?? 1) > 1 ? 'rows' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function classOf(mark: Mark): string {
  return [
    mark.path === undefined ? 'mark' : 'frame',
    mark.assumed === true ? 'assumed' : '',
    mark.event === undefined ? '' : 'written',
  ]
    .filter(Boolean)
    .join(' ')
}

function captionOf(label: string, mark: Mark): string {
  return [
    label,
    formatInstant(mark.at),
    mark.label,
    mark.assumed === true ? 'nature du seuil supposée' : '',
  ]
    .filter(Boolean)
    .join(' · ')
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
