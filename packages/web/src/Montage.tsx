import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import type { Dot } from './transport/dots.ts'
import { Playhead } from './transport/Playhead.tsx'
import { Transport } from './transport/Transport.tsx'
import type { Reading } from './transport/useCursor.ts'
import { useFollowedLine } from './transport/useFollowedLine.ts'
import { useSheet, type Sheet } from './transport/useSheet.ts'
import { trackWidthOf } from './tracks/ruler.ts'
import { TrackList, type TrackListProps } from './tracks/TrackList.tsx'

/**
 * The transport, and the lanes under it: scrolled on their own, under a
 * transport and a ruler that stay.
 *
 * On a phone the lanes fold under the transport, which a finger pulls up to
 * open them, follow the reading line as it moves along them, and fold under a
 * detail.
 */
export function Montage({
  manifest,
  reading,
  front,
  ...lanes
}: Omit<TrackListProps, 'onHold'> & {
  reading: Reading
  /** The window in front, if any. */
  front: string | undefined
}) {
  const width = useMemo(
    () => ({ '--track-w': `${String(trackWidthOf(manifest.period))}px` }) as CSSProperties,
    [manifest.period],
  )
  const scroller = useRef<HTMLDivElement>(null)
  const section = useRef<HTMLElement>(null)
  const sheet = useSheet(section)
  const reveal = useFollowedLine(scroller, sheet.open, manifest.period, reading)
  const onOpenReport = useFoldedByDetails(sheet.close, front, lanes.onOpenReport)
  const onOpenLane = useFoldedByDetails(sheet.close, front, lanes.onOpenLane)
  const onSeek = useRevealing(reveal, lanes.onSeek)

  return (
    <section
      ref={section}
      className={sheet.dragging ? 'replay-montage dragging' : 'replay-montage'}
      data-open={sheet.open}
      style={sheet.style}
    >
      <Player
        {...{ sheet, reading, onJump: reveal, dots: lanes.dots, onSeek: lanes.onSeek }}
        period={manifest.period}
      />
      {/* What scrolls on a phone, under a transport that does not. */}
      <div className="lanes-scroller" id="lanes" ref={scroller}>
        {/* One positioned wrapper for the two: the bar is laid over the lanes,
            and is the only child of the pair that a tick re-renders. */}
        <div className="tracks" style={width}>
          <Playhead period={manifest.period} at={reading.at} />
          <TrackList
            manifest={manifest}
            {...lanes}
            onSeek={onSeek}
            onOpenReport={onOpenReport}
            onOpenLane={onOpenLane}
            onHold={reading.hold}
          />
        </div>
      </div>
    </section>
  )
}

/**
 * The lanes folded as a detail comes in front, and as the lanes open one: it
 * takes the room above them, which they would hide. From the lanes even when
 * the detail was in front already, which no change in front would say.
 */
function useFoldedByDetails<T>(
  close: () => void,
  front: string | undefined,
  onOpen: (what: T) => void,
): (what: T) => void {
  useEffect(() => {
    if (front !== undefined) close()
  }, [front, close])

  return useCallback(
    (what: T) => {
      close()
      onOpen(what)
    },
    [close, onOpen],
  )
}

/**
 * What the reader asks of the reading — a seek, a jump — bringing the line
 * back into sight if it lands out of it. Stable while what it wraps is.
 */
function useRevealing<A extends unknown[]>(reveal: () => void, act: (...args: A) => void) {
  return useCallback(
    (...args: A) => {
      reveal()
      act(...args)
    },
    [reveal, act],
  )
}

/**
 * The transport, and on a phone the handle that pulls the lanes up with it.
 * Its jumps from event to event bring the line back into sight.
 */
function Player({
  sheet,
  reading,
  onJump,
  period,
  dots,
  onSeek,
}: {
  sheet: Sheet
  reading: Reading
  onJump: () => void
  period: TimeWindow
  dots: readonly Dot[]
  onSeek: (fraction: number) => void
}) {
  // Stable, as `useCursor` keeps the jumps they wrap: the transport binds them to the keyboard.
  const next = useRevealing(onJump, reading.toNext)
  const previous = useRevealing(onJump, reading.toPrevious)

  return (
    <div className="player" {...sheet.gesture}>
      {/* The bar is the sign of a sheet a finger pulls; the words say what it brings. */}
      <button
        type="button"
        className="grab"
        aria-expanded={sheet.open}
        aria-controls="lanes"
        onClick={sheet.toggle}
      >
        <span className="grip" aria-hidden="true" />
        {sheet.open ? 'Masquer la chronologie' : 'Afficher la chronologie'}
      </button>
      <Transport
        reading={{ ...reading, toNext: next, toPrevious: previous }}
        {...{ period, dots, onSeek }}
      />
    </div>
  )
}
