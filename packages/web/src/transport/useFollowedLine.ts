import { useCallback, useEffect, useRef, type RefObject } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { PHONE } from '../phone.ts'
import { fractionOf } from './reading.ts'
import { centredScroll, following, type LanesShown, type Turning } from './sheet.ts'
import type { Reading } from './useCursor.ts'

/** How long after the reader asks for an instant the lanes still answer that, rather than the reading. */
const ASKED = 250

/**
 * The lanes of a phone following the reading line as it moves along them, as
 * `following` decides. What the reader asked for holds only an instant, so that
 * a jump that went nowhere is not answered later.
 *
 * Returns what to call before a jump the reader asks for: an event, a lane
 * tapped, the ruler dragged.
 */
export function useFollowedLine(
  scroller: RefObject<HTMLDivElement | null>,
  open: boolean,
  period: TimeWindow,
  reading: Reading,
): () => void {
  const turning = useRef<Turning | undefined>(undefined)
  const revealing = useRef<number | undefined>(undefined)
  const wasOpen = useRef(false)
  const { at } = reading

  useEffect(() => {
    const opening = open && !wasOpen.current
    wasOpen.current = open
    const element = open && matchMedia(PHONE).matches ? scroller.current : null
    if (element === null) return
    const asked = { opening, revealing: performance.now() - (revealing.current ?? -ASKED) < ASKED }
    turning.current = follow(element, fractionOf(period, at), asked, turning.current)
  }, [scroller, open, period, at])

  return useCallback(() => {
    revealing.current = performance.now()
  }, [])
}

/**
 * Scrolls the lanes after the line, `fraction` of the period along them, as
 * `following` decides. Returns the page turn still on its way, if any.
 */
function follow(
  element: HTMLDivElement,
  fraction: number,
  asked: { opening: boolean; revealing: boolean },
  turning: Turning | undefined,
): Turning | undefined {
  const { lanes, track } = measured(element)
  const at = performance.now()
  const next = following(lanes.label + fraction * track, lanes, { ...asked, turning, at })
  if (next.kind === 'centre') {
    element.scrollLeft = centredScroll(fraction, lanes.label, track, lanes.view)
    return undefined
  }
  if (next.kind === 'turn') {
    element.scrollTo({ left: next.to, behavior: 'smooth' })
    return { to: next.to, since: at }
  }
  return next.kind === 'wait' ? turning : undefined
}

/** The lanes as the screen shows them, and how wide their period is drawn. */
function measured(scroller: HTMLDivElement): { lanes: LanesShown; track: number } {
  const label = parseFloat(getComputedStyle(scroller).getPropertyValue('--label-w'))
  const tracks = scroller.firstElementChild
  const width = tracks instanceof HTMLElement ? tracks.offsetWidth : 0
  return {
    lanes: {
      scroll: scroller.scrollLeft,
      maxScroll: scroller.scrollWidth - scroller.clientWidth,
      label,
      view: scroller.clientWidth,
    },
    track: width - label,
  }
}
