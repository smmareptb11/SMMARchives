import type { Lane } from './lanes.ts'

/**
 * Accents, case and punctuation aside, and the numbers in a name read as
 * numbers: « [Chenal de Coursan] » is looked up under C.
 */
const FRENCH = new Intl.Collator('fr', {
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true,
})

/**
 * The lanes in the order a reader looks a source up by: its name. Two of one
 * name, as two cameras of one town, keep the order of their identifiers, so a
 * lane never moves from one load to the next.
 */
export function byLabel(lanes: readonly Lane[]): Lane[] {
  return lanes.toSorted(
    (one, other) => FRENCH.compare(one.label, other.label) || compare(one.id, other.id),
  )
}

function compare(one: string, other: string): number {
  if (one === other) return 0
  return one < other ? -1 : 1
}
