/**
 * The extensions a freeze keeps, and the only ones a replay can hold: the freeze
 * rewrites anything else to `.jpg`, and the API refuses to name what is not here.
 *
 * An allowlist rather than a lookup: `mime` would name an `.svg` or an `.html`,
 * served under a type that invites a browser to run them, which `nosniff` does
 * not prevent.
 */
export const FROZEN_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp'])
