/** What the decision needs to know of the element a key was pressed on. */
type KeyTarget = {
  tagName: string
  /** An input's `type`, lower case; absent on anything else. */
  type?: string | undefined
  isContentEditable?: boolean | undefined
}

/** What the decision needs to know of the key press itself. */
export type EscapePress = {
  key: string
  isComposing: boolean
  defaultPrevented: boolean
}

/** The inputs a reader types into; a checkbox or a button takes no typing. */
const TYPED = new Set([
  'text',
  'search',
  'email',
  'number',
  'password',
  'tel',
  'url',
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
])

/**
 * Whether the reader is typing where the key was pressed: there, Escape belongs
 * to the field — it clears a search, closes the list of a select — and a
 * window closing under the text being written would lose it.
 */
export function isTyping(target: KeyTarget | null): boolean {
  if (target === null) return false
  if (target.isContentEditable === true) return true

  const tag = target.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  return tag === 'input' && TYPED.has(target.type ?? 'text')
}

/**
 * Whether Escape closes the window in front, wherever the focus is, since a
 * window opened from the history or a lane takes none. Not while typing, nor
 * during a composition, nor once something else handled the key.
 */
export function escapeCloses(press: EscapePress, target: KeyTarget | null): boolean {
  if (press.key !== 'Escape' || press.isComposing || press.defaultPrevented) return false
  return !isTyping(target)
}
