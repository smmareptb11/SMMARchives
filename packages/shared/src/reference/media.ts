/**
 * The extensions a freeze keeps, and the only ones a replay can hold.
 *
 * Frozen reference data, shared because both ends read it: the freeze rewrites
 * anything else to `.jpg`, and the API refuses to name what is not here rather
 * than trusting a name it did not choose. Kept apart, the two lists would
 * drift, and a stored `.jpeg` would go out as an anonymous stream of bytes.
 *
 * An allowlist rather than a lookup: `mime` would happily name an `.svg` or an
 * `.html`, and `nosniff` does not protect against those being served under a
 * type that invites a browser to run them.
 */
export const FROZEN_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp'])
