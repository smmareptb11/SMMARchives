import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { replayPath } from '../routing.ts'
import { formatInstant } from '../time.ts'

const STATE_LABEL: Record<ReplayManifest['state'], string> = {
  running: 'En cours',
  complete: 'Complet',
  partial: 'Partiel',
  failed: 'Échoué',
}

export type ReplayEntry = {
  id: string
  href: string
  title: string
  period: string
  createdAt: string
  state: ReplayManifest['state']
  stateLabel: string
}

/**
 * One line of the list, read from the manifest alone.
 *
 * No data set is opened: the list is the index of what was frozen, and a
 * screen that fetched every replay's content to name it would cost a build's
 * worth of reads per visit.
 */
export function entryOf(manifest: ReplayManifest): ReplayEntry {
  return {
    id: manifest.id,
    href: replayPath(manifest.id),
    title: manifest.label ?? 'Rejeu sans titre',
    period: `Du ${formatInstant(manifest.period.from)} au ${formatInstant(manifest.period.to)}`,
    createdAt: formatInstant(manifest.createdAt),
    state: manifest.state,
    stateLabel: STATE_LABEL[manifest.state],
  }
}

/**
 * The lines of the list, in the order the API gave them.
 *
 * Not sorted again: the API already orders on `createdAt`, and a second rule
 * here could only drift from the first.
 */
export function entriesOf(manifests: readonly ReplayManifest[]): ReplayEntry[] {
  return manifests.map(entryOf)
}
