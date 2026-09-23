import { useEffect } from 'react'

import { SPEEDS, instantAt, nextMark, previousMark, type Speed } from './reading.ts'
import { formatInstant } from '../time.ts'
import type { Reading } from './useCursor.ts'

/**
 * Playing, pausing, and jumping from one crossing to the next.
 *
 * The instant is the one thing on this bar a reader has to read, so it is the
 * one thing written large — in French time, like every instant the interface
 * shows.
 */
export function Transport({ reading }: { reading: Reading }) {
  useKeyboard(reading)

  return (
    <div className="transport">
      <button
        type="button"
        onClick={reading.toPrevious}
        disabled={previousMark(reading.marks, reading.at) === undefined}
        title="Franchissement précédent"
      >
        ⏮
      </button>
      <button type="button" onClick={reading.playing ? reading.pause : reading.play}>
        {reading.playing ? '⏸ Pause' : '▶ Lecture'}
      </button>
      <button
        type="button"
        onClick={reading.toNext}
        disabled={nextMark(reading.marks, reading.at) === undefined}
        title="Franchissement suivant"
      >
        ⏭
      </button>

      <label className="speed">
        Vitesse
        <select
          value={reading.speed}
          onChange={(event) => {
            reading.setSpeed(Number(event.target.value) as Speed)
          }}
        >
          {SPEEDS.map((one) => (
            <option key={one} value={one}>
              {one} min / s
            </option>
          ))}
        </select>
      </label>

      <time className="clock">{formatInstant(instantAt(reading.at))}</time>
    </div>
  )
}

/**
 * Space plays, the arrows jump from one crossing to the next.
 *
 * Bound on the document rather than on the bar, so a reader looking at the map
 * does not have to find a button first. Ignored while anything else holds the
 * focus, or space would start the reading instead of ticking a checkbox.
 */
function useKeyboard(reading: Reading): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target !== document.body) return
      if (event.key === ' ') (reading.playing ? reading.pause : reading.play)()
      else if (event.key === 'ArrowRight') reading.toNext()
      else if (event.key === 'ArrowLeft') reading.toPrevious()
      else return
      event.preventDefault()
    }

    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
    }
    // Four of the five are memoised by `useCursor`. The fifth, `playing`, must change, and it is
    // what rebinds the listener — which is the point. `reading` is a new object on every render,
    // and watching it would rebind on every frame instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the members, not the object holding them
  }, [reading.playing, reading.play, reading.pause, reading.toNext, reading.toPrevious])
}
