import { useEffect, type RefObject } from 'react'

/**
 * How far the pointer may travel between pressing and releasing for the
 * gesture to count as a click, in pixels. Further, it was a drag: panning the
 * map is not asking for the panel to close.
 */
const STILL = 5

/**
 * Calls `onOutside` on a click anywhere but inside `held`, while `active`.
 *
 * Listened to in the capture phase, ahead of the page's own handlers: a click
 * on another mark closes this panel first and opens that one after, rather than
 * opening it and having the close land on top.
 */
export function useClickOutside(
  held: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!active) return
    let pressed: { x: number; y: number } | undefined

    const onDown = (event: PointerEvent) => {
      pressed = { x: event.clientX, y: event.clientY }
    }
    const onClick = (event: MouseEvent) => {
      const moved =
        pressed !== undefined &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > STILL
      if (moved || held.current === null || held.current.contains(event.target as Node)) return
      onOutside()
    }

    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [held, active, onOutside])
}
