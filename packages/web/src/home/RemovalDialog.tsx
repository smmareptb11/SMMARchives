import { useEffect, useId, useRef, useState } from 'react'

import { api } from '../api.ts'
import { ApiError, describe } from '../problems.ts'
import { goTo, signInPath } from '../routing.ts'
import type { ReplayEntry } from './entries.ts'

/**
 * Asking before a replay is removed, in a modal of the browser's own: it
 * dims the page, keeps the keyboard inside, closes on Escape and hands the
 * focus back to the button that opened it.
 *
 * « Annuler » comes first, so the focus the modal opens on keeps nothing.
 */
export function RemovalDialog({
  entry,
  onClose,
  onRemoved,
}: {
  entry: ReplayEntry
  onClose: () => void
  onRemoved: (id: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const close = () => dialog.current?.close()
  const { remove, removing, failure } = useRemoving(entry.id, (id) => {
    onRemoved(id)
    close()
  })

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="removal-dialog"
      aria-labelledby={title}
      onClose={onClose}
      onCancel={(event) => {
        // Escape while the request is out would hide a removal still going on.
        if (removing) event.preventDefault()
      }}
    >
      <h2 id={title}>Supprimer ce rejeu ?</h2>
      <WhatGoes entry={entry} />
      {failure === undefined ? null : (
        <p className="refusal" role="alert">
          {failure}
        </p>
      )}
      <footer>
        <button type="button" className="quiet" disabled={removing} onClick={close}>
          Annuler
        </button>
        <button type="button" className="danger" disabled={removing} onClick={() => void remove()}>
          {removing ? 'Suppression…' : 'Supprimer définitivement'}
        </button>
      </footer>
    </dialog>
  )
}

/** Which replay goes, and what goes with it. */
function WhatGoes({ entry }: { entry: ReplayEntry }) {
  return (
    <>
      <p className="named">
        <strong>{entry.title}</strong>
        <span>{entry.period}</span>
      </p>
      <p>Le rejeu, ses images et ses événements seront supprimés définitivement.</p>
      {entry.public ? <p>Ce rejeu est public : il disparaîtra pour tout le monde.</p> : null}
    </>
  )
}

/** Asking the API to remove it, and saying why it would not. */
function useRemoving(id: string, onRemoved: (id: string) => void) {
  const [removing, setRemoving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  async function remove(): Promise<void> {
    setRemoving(true)
    setFailure(undefined)
    try {
      await api.removeReplay(id)
      setRemoving(false)
      onRemoved(id)
    } catch (error) {
      // The session ran out: to the sign-in, which comes back to this list.
      if (error instanceof ApiError && error.problem.status === 401) {
        goTo(signInPath(location.pathname))
        return
      }
      setFailure(describe(error))
      setRemoving(false)
    }
  }

  return { remove, removing, failure }
}
