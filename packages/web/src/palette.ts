import { SHADES } from './rain.ts'

/**
 * The colours a canvas has to repeat, because it cannot read the stylesheet.
 *
 * `styles.css` holds the one definition of each; MapLibre paints from an
 * expression and uPlot from a drawing context, and neither reads a custom
 * property. This is the one place that spells the values a second time, so
 * that a change of palette has two files to visit and not four.
 */

/** `--brand`: the mark of a source on the map, and the curve of a station. */
export const BRAND = '#14496b'

/** `--ink-2`: what is said beside the thing rather than about it, axes included. */
export const MUTED = '#5b6b7c'

/**
 * `--rain`: the bars of a rain gauge, on its lane and in its bubble.
 *
 * Read off the map's own ramp rather than spelled again, as `NEGLIGIBLE` is:
 * the bars and the markers speak the same blue, and two copies would drift
 * apart at the first change of ramp.
 */
export const RAIN = SHADES[3].colour
