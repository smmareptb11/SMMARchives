/**
 * The password `npm run hash-password` was given, without the line ending the
 * pipe added. Only that one: a space or a tab at its end is part of it, and
 * dropping it would hash a password the administrator never types.
 */
export function pipedPassword(input: string): string {
  return input.replace(/\r?\n$/, '')
}

export type Keyed = { typed: string } | { done: string } | { interrupted: true }

/**
 * What one key does to a password typed without echo. Erasing comes as DEL or
 * BS depending on the terminal; Ctrl-D stops as Ctrl-C does. Kept as
 * characters, they would end up in a hash nobody can sign in with.
 */
export function keyed(typed: string, key: string): Keyed {
  if (key === '\u0003' || key === '\u0004') return { interrupted: true }
  if (key === '\r' || key === '\n') return { done: typed }
  if (key === '\u007f' || key === '\b') return { typed: typed.slice(0, -1) }
  return { typed: typed + key }
}
