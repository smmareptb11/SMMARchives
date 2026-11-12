import { useRef, type PointerEvent } from 'react'

import { fractionAt } from '../tracks/pointer.ts'

/**
 * Dragging the reading along a ruler, as the mockup lets one: the lanes' own,
 * or the bar over a phone's transport.
 *
 * The pointer is captured on press, so the drag goes on wherever it wanders —
 * down over the lanes, or out of the montage — until it is let go: a ruler
 * twenty-six pixels high is lost by the slightest slip otherwise. The reading
 * holds still meanwhile, and resumes on release if it was playing, rather than
 * pulling the cursor away from the hand that moves it. Pointer events rather
 * than mouse ones, so a finger drags it too.
 */
export function useDrag(onSeek: (fraction: number) => void, onHold: () => () => void) {
  const resume = useRef<(() => void) | undefined>(undefined)
  const release = () => {
    resume.current?.()
    resume.current = undefined
  }

  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      // One drag at a time: a second finger would take over the first's
      // promise to resume the reading, and break it.
      if (event.button !== 0 || resume.current !== undefined) return
      event.currentTarget.setPointerCapture(event.pointerId)
      resume.current = onHold()
      onSeek(fractionAt(event))
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(fractionAt(event))
    },
    // However the capture ends — let go, cancelled, or lost to another window —
    // this is the one event that always comes.
    onLostPointerCapture: release,
  }
}
