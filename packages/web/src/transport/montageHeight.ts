/** How tall the lanes' panel may be made, in pixels. */
export type HeightRange = { min: number; max: number }

/** How far a key moves the panel's edge. */
export const KEY_STEP = 32

/**
 * From the panel folded, which is where it opens, to half the area under the
 * band — and never less than folded, on a window too short for the half.
 */
export function rangeOf(folded: number, area: number): HeightRange {
  return { min: folded, max: Math.max(folded, Math.round(area / 2)) }
}

export function within(height: number, range: HeightRange): number {
  return Math.min(Math.max(height, range.min), range.max)
}

/**
 * The height a key on the handle asks for, or nothing for a key it does not
 * take. Up raises the edge, so the panel grows, as dragging it up does.
 */
export function heightAfterKey(
  height: number,
  key: string,
  range: HeightRange,
): number | undefined {
  switch (key) {
    case 'ArrowUp':
      return within(height + KEY_STEP, range)
    case 'ArrowDown':
      return within(height - KEY_STEP, range)
    case 'Home':
      return range.min
    case 'End':
      return range.max
    default:
      return undefined
  }
}
