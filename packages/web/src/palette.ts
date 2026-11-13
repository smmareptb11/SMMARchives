import { SHADES } from './rain.ts'

/**
 * The colours a canvas has to repeat, because neither MapLibre nor uPlot reads a
 * custom property: `styles/base.css` holds the one definition of each, and this
 * is the one place that spells them a second time.
 */

/** `--brand`: the mark of a source on the map, and the curve of a station. */
export const BRAND = '#004a73'

/** `--ink-2`: what is said beside the thing rather than about it, axes included. */
export const MUTED = '#536372'

/** `--night-ink-2`: the same, on the montage's dark ground: the hours of the ruler. */
export const NIGHT_MUTED = '#8fa3b4'

/**
 * `--rain`: the bars of a rain gauge, on its lane and in its bubble, read off the
 * map's own ramp so that the bars and the markers speak the same blue.
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
