import type { z } from 'zod'

import type { DatasetName, ReportCollector } from '@smmarchives/shared'

import type { ReplayStore } from './store.ts'

export type PreserveOptions<T> = {
  store: ReplayStore
  collector: ReportCollector
  dataset: DatasetName
  contract: z.ZodType<T[]>
  /** What the source offers now. */
  collected: readonly T[]
  /** Tells two entries apart. Two entries with one key are the same entry. */
  keyOf: (entry: T) => string
  /** Whether an entry a previous run stored is still worth carrying. */
  isStillHeld: (entry: T) => Promise<boolean>
  /** Groups the recovered entries in the report, one fallback per group. */
  groupOf: (entry: T) => string
  rule: string
}

/**
 * Adds back what a previous run stored and the source no longer offers.
 *
 * A re-run recollects from sources that forget: Ceneau keeps a webcam image for
 * a month, so a fresh listing of an older period is shorter than what the replay
 * already froze. Overwriting blind drops exactly what the freeze saved, leaving
 * the copies on disk with nothing pointing at them while the replay reports
 * itself complete.
 *
 * Deliberately not folded into `ReplayBuild.stored`, which every data set passes
 * through: merging is right where a source *forgets* and wrong where it
 * *corrects*. A measure Aquasys stops returning may well be a correction, and
 * silently keeping the old one would be the same defect in the other direction.
 * A lane opts in, and says by what key and on what condition.
 *
 * Each recovery is a fallback, because the replay then holds more than its
 * source can still show — which is the freeze working, and worth reading in the
 * administration.
 */
export async function withPreserved<T>(options: PreserveOptions<T>): Promise<T[]> {
  const previous = options.contract.safeParse(await options.store.getDataset(options.dataset))
  if (!previous.success) return [...options.collected]

  const offered = new Set(options.collected.map(options.keyOf))
  const recovered: T[] = []
  for (const entry of previous.data) {
    if (offered.has(options.keyOf(entry))) continue
    if (await options.isStillHeld(entry)) recovered.push(entry)
  }
  if (recovered.length === 0) return [...options.collected]

  for (const group of new Set(recovered.map(options.groupOf))) {
    options.collector.fellBackTo({
      subject: group,
      rule: options.rule,
      applied: `${recovered.filter((one) => options.groupOf(one) === group).length} entr(ies) kept from an earlier run`,
    })
  }

  return [...options.collected, ...recovered]
}
