import type { MouseEvent } from 'react'

/**
 * Where a point stands across a box, as a fraction of its width — which is a
 * fraction of the period, on a ruler or on a lane. Past either edge, the
 * fraction goes past 0 or 1: the reading clamps it, not this.
 */
export function fractionAcross(x: number, left: number, width: number): number {
  return (x - left) / width
}

/** Where the pointer stands across the element it acts on. */
export function fractionAt(event: MouseEvent<HTMLElement>): number {
  const box = event.currentTarget.getBoundingClientRect()
  return fractionAcross(event.clientX, box.left, box.width)
}
