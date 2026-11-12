import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react'

import { PHONE } from '../phone.ts'
import { offsetWithin, sizeWithin, type Box, type Offset, type Size } from './floating.ts'

/** What the heading listens to, to move the panel it heads. */
export type Drag = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onLostPointerCapture: () => void
}

/**
 * Where the panel was moved, from where it started, and the hold that moves it.
 *
 * Pointer events with a capture, as the ruler's, so a finger moves it too and a
 * pointer leaving the heading mid-move does not drop it. A press on the way out
 * is not a move. Held within the screen while moved, and after: a camera's view
 * is taller than a curve.
 */
export function useFloating(
  panel: RefObject<HTMLElement | null>,
  start: Offset,
): { style: CSSProperties; moving: boolean; drag: Drag; sized: boolean; resize: Drag } {
  const [offset, setOffset] = useState<Offset>(start)
  const [moving, setMoving] = useState(false)
  const held = useRef<{ from: Offset; pointer: Offset; box: Box } | undefined>(undefined)

  useKeptOnScreen(panel, setOffset)
  const { size, resizing, resize } = useResized(panel)

  const drag: Drag = {
    onPointerDown: (event) => {
      const element = panel.current
      if (event.button !== 0 || element === null || matchMedia(PHONE).matches) return
      if (event.target instanceof Element && event.target.closest('button') !== null) return
      event.currentTarget.setPointerCapture(event.pointerId)
      held.current = {
        from: offset,
        pointer: { x: event.clientX, y: event.clientY },
        box: boxOf(element, offset),
      }
      setMoving(true)
    },
    onPointerMove: (event) => {
      const now = held.current
      if (now === undefined || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      const wanted = {
        x: now.from.x + event.clientX - now.pointer.x,
        y: now.from.y + event.clientY - now.pointer.y,
      }
      setOffset(offsetWithin(now.box, wanted, screenSize()))
    },
    onLostPointerCapture: () => {
      held.current = undefined
      setMoving(false)
    },
  }

  return {
    // Variables the stylesheet moves and sizes the window by, which a phone's leaves unapplied.
    style: {
      '--callout-x': `${String(offset.x)}px`,
      '--callout-y': `${String(offset.y)}px`,
      ...(size === undefined
        ? {}
        : { '--callout-w': `${String(size.width)}px`, '--callout-h': `${String(size.height)}px` }),
    } as CSSProperties,
    moving: moving || resizing,
    drag,
    sized: size !== undefined,
    resize,
  }
}

/**
 * The size the reader gave the window by its corner, and the hold that gives
 * it. None until they do: the window keeps the size its content gives it.
 *
 * The same pointer capture as a move, so a pointer leaving the corner mid-way
 * does not drop it. Not on a phone, where a window takes the whole map.
 */
function useResized(panel: RefObject<HTMLElement | null>): {
  size: Size | undefined
  resizing: boolean
  resize: Drag
} {
  const [size, setSize] = useState<Size | undefined>(undefined)
  const [resizing, setResizing] = useState(false)
  const held = useRef<{ from: Size; pointer: Offset; at: Offset } | undefined>(undefined)

  const resize: Drag = {
    onPointerDown: (event) => {
      const element = panel.current
      if (event.button !== 0 || element === null || matchMedia(PHONE).matches) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const { left, top, width, height } = element.getBoundingClientRect()
      held.current = {
        from: { width, height },
        pointer: { x: event.clientX, y: event.clientY },
        at: { x: left, y: top },
      }
      setResizing(true)
    },
    onPointerMove: (event) => {
      const now = held.current
      if (now === undefined || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      const wanted = {
        width: now.from.width + event.clientX - now.pointer.x,
        height: now.from.height + event.clientY - now.pointer.y,
      }
      setSize(sizeWithin({ left: now.at.x, top: now.at.y }, wanted, screenSize()))
    },
    onLostPointerCapture: () => {
      held.current = undefined
      setResizing(false)
    },
  }

  return { size, resizing, resize }
}

/** The panel brought back within the screen whenever the window or the panel changes size. */
function useKeptOnScreen(
  panel: RefObject<HTMLElement | null>,
  setOffset: Dispatch<SetStateAction<Offset>>,
): void {
  useEffect(() => {
    const element = panel.current
    if (element === null) return
    const keep = () => {
      setOffset((now) => offsetWithin(boxOf(element, now), now, screenSize()))
    }
    const observer = new ResizeObserver(keep)
    observer.observe(element)
    addEventListener('resize', keep)
    return () => {
      observer.disconnect()
      removeEventListener('resize', keep)
    }
  }, [panel, setOffset])
}

/** Where the panel would stand unmoved: where it stands, less the move. */
function boxOf(element: HTMLElement, offset: Offset): Box {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left: left - offset.x, top: top - offset.y, width, height }
}

function screenSize(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }
}
