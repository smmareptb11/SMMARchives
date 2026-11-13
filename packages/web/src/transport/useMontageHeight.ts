import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type HTMLAttributes,
  type RefObject,
  type SetStateAction,
} from 'react'

import { PHONE } from '../phone.ts'
import { heightAfterKey, rangeOf, within, type HeightRange } from './montageHeight.ts'

/**
 * The height of the lanes' panel on a wide screen, and the handle on its top
 * edge that sets it: it opens folded, and is raised up to half the area under
 * the band. Unfolding a family does not raise it: its lanes scroll inside.
 *
 * Nothing here runs on a phone, where the lanes are a sheet a finger pulls.
 */
export function useMontageHeight(section: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | undefined>(undefined)
  const range = useRange(section, setHeight)

  // The camera views over the map are sized against the panel: they read it off the replay.
  useLayoutEffect(() => {
    if (height === undefined) return
    section.current?.parentElement?.style.setProperty('--montage-h', `${String(height)}px`)
  }, [section, height])

  const handle = useHandle(height, range, setHeight)
  const style =
    height === undefined
      ? undefined
      : ({ '--montage-chosen': `${String(height)}px` } as CSSProperties)

  return { handle, style }
}

/**
 * The heights the panel may take, measured before the first paint while every
 * family is folded — that height is the floor — and again as the window moves,
 * which also brings the panel back within them.
 */
function useRange(
  section: RefObject<HTMLElement | null>,
  setHeight: Dispatch<SetStateAction<number | undefined>>,
): HeightRange | undefined {
  const [range, setRange] = useState<HeightRange | undefined>(undefined)

  useLayoutEffect(() => {
    const panel = section.current
    if (panel === null || matchMedia(PHONE).matches) return
    const folded = panel.offsetHeight
    const measure = () => {
      const next = rangeOf(folded, panel.parentElement?.clientHeight ?? folded)
      setRange(next)
      setHeight((held) => within(held ?? folded, next))
    }
    measure()
    addEventListener('resize', measure)
    return () => {
      removeEventListener('resize', measure)
    }
  }, [section, setHeight])

  return range
}

/** What the handle answers: a drag of its edge, and the keys of a separator. */
function useHandle(
  height: number | undefined,
  range: HeightRange | undefined,
  setHeight: (height: number) => void,
): HTMLAttributes<HTMLElement> | undefined {
  const press = useRef<{ y: number; height: number } | undefined>(undefined)
  if (height === undefined || range === undefined) return undefined

  const release = () => {
    press.current = undefined
  }
  return {
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-label': 'Hauteur de la chronologie',
    'aria-valuemin': range.min,
    'aria-valuemax': range.max,
    'aria-valuenow': height,
    tabIndex: 0,
    onPointerDown: (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      press.current = { y: event.clientY, height }
    },
    onPointerMove: (event) => {
      if (press.current === undefined) return
      setHeight(within(press.current.height - (event.clientY - press.current.y), range))
    },
    onPointerUp: release,
    onPointerCancel: release,
    onKeyDown: (event) => {
      const next = heightAfterKey(height, event.key, range)
      if (next === undefined) return
      event.preventDefault()
      setHeight(next)
    },
  }
}
