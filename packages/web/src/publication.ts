import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

export type Publication = {
  /** Whether everyone sees it, said beside the button. */
  status: string
  action: 'publish' | 'withdraw'
  label: string
  /** Why the API would refuse it, for a button turned off that says so. */
  refusal: string | undefined
}

/** What the administrator is told of a replay's publication, and offered to do with it. */
export function publicationOf(manifest: ReplayManifest): Publication {
  if (manifest.publishedAt !== undefined) {
    return { status: 'Public', action: 'withdraw', label: 'Rendre privé', refusal: undefined }
  }
  return {
    status: 'Privé',
    action: 'publish',
    label: 'Rendre public',
    refusal:
      manifest.state === 'complete' ? undefined : 'Seul un rejeu complet peut être rendu public.',
  }
}

/** The manifest as the API holds it once published or withdrawn, at the date given. */
export function withPublication(
  manifest: ReplayManifest,
  publishedAt: string | undefined,
): ReplayManifest {
  const { publishedAt: _, ...unpublished } = manifest
  return publishedAt === undefined ? unpublished : { ...unpublished, publishedAt }
}
