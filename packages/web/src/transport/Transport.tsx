import { useEffect } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import type { Dot } from './dots.ts'
import {
  SPEEDS,
  instantAt,
  nextMark,
  previousMark,
  shortcutFor,
  type KeyFocus,
  type Shortcut,
  type Speed,
} from './reading.ts'
import { Scrub } from './Scrub.tsx'
import { isTyping } from '../map/escape.ts'
import { formatDate, formatHour } from '../time.ts'
import type { Reading } from './useCursor.ts'

/**
 * Playing, pausing, and jumping from one event to the next — a crossing or a report.
 *
 * The instant is the one thing on this bar a reader has to read, so it is the
 * one thing written large — in French time, like every instant the interface
 * shows. The buttons are icons, each named by its title for the hover and
 * the screen reader alike.
 */
export function Transport({
  reading,
  period,
  dots,
  onSeek,
}: {
  reading: Reading
  period: TimeWindow
  dots: readonly Dot[]
  /** Where the reader pointed on the bar, as a fraction of the period. */
  onSeek: (fraction: number) => void
}) {
  useKeyboard(reading)
  const instant = instantAt(reading.at)

  return (
    <div className={reading.playing ? 'transport playing' : 'transport'}>
      <Scrub {...{ period, dots, onSeek }} at={reading.at} onHold={reading.hold} />
      <IconButton
        name="Événement précédent"
        keys="←, Maj+← : une heure plus tôt"
        shortcut="ArrowLeft Shift+ArrowLeft"
        icon={PREVIOUS}
        onClick={reading.toPrevious}
        disabled={previousMark(reading.marks, reading.at) === undefined}
      />
      <IconButton
        name={reading.playing ? 'Pause' : 'Lecture'}
        keys="Espace"
        shortcut="Space"
        icon={reading.playing ? PAUSE : PLAY}
        onClick={reading.playing ? reading.pause : reading.play}
        className="play"
      />
      <IconButton
        name="Événement suivant"
        keys="→, Maj+→ : une heure plus tard"
        shortcut="ArrowRight Shift+ArrowRight"
        icon={NEXT}
        onClick={reading.toNext}
        disabled={nextMark(reading.marks, reading.at) === undefined}
      />

      <SpeedChoice speed={reading.speed} onSpeed={reading.setSpeed} />

      <time className="clock" dateTime={instant}>
        <span className="live" />
        <span className="date">{formatDate(instant)}</span>
        <span className="hour">{formatHour(instant)}</span>
      </time>
    </div>
  )
}

/**
 * The speed, chosen from a list. On a phone the list is laid over a button
 * like its neighbours, which says the speed: tapped, it still opens the
 * phone's own picker.
 */
function SpeedChoice({ speed, onSpeed }: { speed: Speed; onSpeed: (speed: Speed) => void }) {
  return (
    <label className="speed">
      <span className="speed-name">Vitesse</span>
      <span className="speed-shown" aria-hidden="true">
        {speed} min/s
      </span>
      <select
        value={speed}
        onChange={(event) => {
          onSpeed(Number(event.target.value) as Speed)
        }}
      >
        {SPEEDS.map((one) => (
          <option key={one} value={one}>
            {one} min / s
          </option>
        ))}
      </select>
    </label>
  )
}

const PREVIOUS = 'M4 2h2v12H4zM14 2v12L7 8z'
const PLAY = 'M3 2v12l11-6z'
const PAUSE = 'M3 2h4v12H3zM9 2h4v12H9z'
const NEXT = 'M10 2h2v12h-2zM2 2v12l7-6z'

function IconButton({
  name,
  keys,
  shortcut,
  icon,
  onClick,
  disabled,
  className,
}: {
  name: string
  /** The keys that do the same, as the hover says them. */
  keys: string
  /** The same keys, as `aria-keyshortcuts` spells them. */
  shortcut: string
  /** The path of a 16 × 16 glyph. */
  icon: string
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={className}
      title={`${name} (${keys})`}
      aria-label={name}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
      disabled={disabled}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={icon} />
      </svg>
    </button>
  )
}

/**
 * Space plays, the arrows jump from one crossing to the next, and with Shift
 * they move the reading by an hour.
 *
 * Bound on the document rather than on the bar, so a reader looking at the map
 * does not have to find a button first. What a key does where the focus stands
 * is `shortcutFor`'s to say.
 */
function useKeyboard(reading: Reading): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const shortcut = shortcutFor(event.key, event.shiftKey, focusOf(event.target))
      if (shortcut === undefined) return
      const act: Record<Shortcut, () => void> = {
        toggle: reading.playing ? reading.pause : reading.play,
        next: reading.toNext,
        previous: reading.toPrevious,
        forward: reading.forward,
        back: reading.back,
      }
      act[shortcut]()
      event.preventDefault()
    }

    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
    }
    // All but `playing` are memoised by `useCursor`. `playing` must change, and it is what rebinds
    // the listener — which is the point. `reading` is a new object on every render, and watching
    // it would rebind on every frame instead.
  }, [
    reading.playing,
    reading.play,
    reading.pause,
    reading.toNext,
    reading.toPrevious,
    reading.forward,
    reading.back,
  ])
}

/** The element a key was pressed on, as `shortcutFor` sorts it. */
function focusOf(target: EventTarget | null): KeyFocus {
  if (!(target instanceof HTMLElement)) return 'none'
  const type = target instanceof HTMLInputElement ? target.type : undefined
  if (isTyping({ tagName: target.tagName, type, isContentEditable: target.isContentEditable })) {
    return 'typing'
  }
  if (target.closest('button, a[href], summary, input, [role="button"]') !== null)
    return 'pressable'
  if (target.closest('.maplibregl-map') !== null) return 'map'
  return 'none'
}
