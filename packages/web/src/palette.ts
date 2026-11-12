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
export const BRAND = '#004a73'

/** `--ink-2`: what is said beside the thing rather than about it, axes included. */
export const MUTED = '#536372'

/** `--night-ink-2`: the same, on the montage's dark ground: the hours of the ruler. */
export const NIGHT_MUTED = '#8fa3b4'

/**
 * `--rain`: the bars of a rain gauge, on its lane and in its bubble.
 *
 * Read off the map's own ramp rather than spelled again, as `NEGLIGIBLE` is:
 * the bars and the markers speak the same blue, and two copies would drift
 * apart at the first change of ramp.
 */
export const RAIN = SHADES[3].colour

/** `--cumul`: the running total over a rain gauge's bars, the Acycliq widget's orange. */
export const CUMUL = '#ea580c'

/**
 * `--pointed`: what the pointer rests on in the lanes or the history, on the
 * map. Dark, where a selected source is outlined in its own colour: the two
 * can stand side by side, and must not be read as one.
 */
export const POINTED = '#14212b'

/** `--report`: what an agent reported, on its lane and on the map while under way. */
export const REPORT = '#2e8540'
