import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from 'react'

import { PHONE } from '../phone.ts'
import { DRAG_START, followed, settled } from './sheet.ts'

/** What keeps its own gesture on the transport: the bar seeks, the controls are pressed. */
const OWN_GESTURES = '.scrub, button:not(.grab), select, label'

/** The lanes' state under a phone's transport, and what moves it. */
export type Sheet = ReturnType<typeof useSheet>

/**
 * The lanes folded under a phone's transport, and the finger that pulls them. A
 * press becomes a drag, and takes the pointer, only once it has moved a few
 * pixels: a tap on the handle stays a click, which toggles the lanes.
 */
export function useSheet(sheet: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false)
  const [travel, setTravel] = useState<number | undefined>(undefined)
  const press = useRef<{ y: number; height: number } | undefined>(undefined)

  const close = useCallback(() => {
    setOpen(false)
  }, [])
  const end = () => {
    press.current = undefined
    setTravel(undefined)
  }

  const gesture = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !event.isPrimary || !matchMedia(PHONE).matches) return
      if (event.target instanceof Element && event.target.closest(OWN_GESTURES) !== null) return
      press.current = { y: event.clientY, height: foldOf(sheet.current) }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (press.current === undefined) return
      // Let go somewhere else before it moved enough to take the pointer: no longer a press.
      if (event.buttons === 0) {
        end()
        return
      }
      const moved = event.clientY - press.current.y
      if (travel === undefined && Math.abs(moved) < DRAG_START) return
      if (travel === undefined) event.currentTarget.setPointerCapture(event.pointerId)
      setTravel(moved)
    },
    onPointerUp: () => {
      if (press.current !== undefined && travel !== undefined) {
        setOpen(settled(open, travel, press.current.height))
      }
      end()
    },
    onPointerCancel: end,
  }

  return {
    open,
    dragging: travel !== undefined,
    style:
      travel === undefined
        ? undefined
        : translated(followed(open, travel, press.current?.height ?? 0)),
    gesture,
    toggle: () => {
      setOpen(!open)
    },
    close,
  }
}

function translated(down: number): CSSProperties {
  return { transform: `translateY(${String(down)}px)` }
}

/**
 * How far the lanes fold: the sheet's height but for the transport that stays
 * when they are folded. Not the lanes' own height, which grows as the open
 * transport gives up its bar.
 */
function foldOf(sheet: HTMLElement | null): number {
  if (sheet === null) return 0
  const style = getComputedStyle(sheet)
  return parseFloat(style.height) - parseFloat(style.getPropertyValue('--player-h'))
}
