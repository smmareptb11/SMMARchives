import { useState } from 'react'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { api } from './api.ts'
import { ApiError, describe } from './problems.ts'
import { publicationOf } from './publication.ts'
import { goTo, signInPath } from './routing.ts'

/**
 * Publishing a replay, or withdrawing it, from its own screen: what is published
 * is what the administrator has just been looking at. Neither asks first, since
 * either is undone by the other.
 */
export function PublicationControl({
  manifest,
  onChanged,
}: {
  manifest: ReplayManifest
  /** The manifest as the API holds it now, for the screen to show. */
  onChanged: (manifest: ReplayManifest) => void
}) {
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const { status, action, label, refusal } = publicationOf(manifest)

  async function change(): Promise<void> {
    setFailure(undefined)
    setSending(true)
    try {
      onChanged(await (action === 'publish' ? api.publish : api.unpublish)(manifest.id))
    } catch (error) {
      // The session ran out: to the sign-in, which comes back here, where the
      // replay is still shown as it was before the click.
      if (error instanceof ApiError && error.problem.status === 401) {
        goTo(signInPath(location.pathname))
      } else setFailure(describe(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <span className="publication">
      {failure === undefined ? null : (
        // Cut to fit the band, and whole on hover.
        <span className="publication-failure" role="alert" title={failure}>
          {failure}
        </span>
      )}
      <span>{refusal ?? status}</span>
      <button
        type="button"
        disabled={refusal !== undefined || sending}
        onClick={() => void change()}
      >
        {label}
      </button>
    </span>
  )
}
