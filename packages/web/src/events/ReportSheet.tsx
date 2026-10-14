import { useEffect, useRef, useState } from 'react'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { api } from '../api.ts'
import { describe } from '../problems.ts'
import { formatInstant } from '../time.ts'

export type ReportSheetProps = {
  report: ReplayEvent
  replayId: string
  onClose: () => void
  onEdit: () => void
  /** The API removed it: the screen lets it go, and the sheet with it. */
  onRemoved: (id: string) => void
}

/**
 * Everything an agent wrote of an event, opened from the mark that stands for it.
 *
 * Opened and closed by the reader alone: nothing the cursor or the map does
 * takes it away, so what one is reading stays there while the replay plays.
 */
export function ReportSheet({ report, replayId, onClose, onEdit, onRemoved }: ReportSheetProps) {
  const closing = useRef<HTMLButtonElement>(null)

  // On the button that closes it, so the keyboard lands where the sheet is
  // rather than on the mark it was opened from.
  useEffect(() => {
    closing.current?.focus()
  }, [report.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <aside className="sheet" role="dialog" aria-labelledby="sheet-title">
      <header>
        <h2 id="sheet-title">{report.title}</h2>
        <button type="button" ref={closing} onClick={onClose} aria-label="Fermer la fiche">
          ×
        </button>
      </header>
      <p className="when">{whenOf(report)}</p>
      <p className="note">Signalé par : {report.producerKind}</p>
      {report.description === null ? null : <p className="description">{report.description}</p>}
      <Photos key={report.id} paths={report.media} replayId={replayId} title={report.title} />
      <Actions
        key={`actions-${report.id}`}
        report={report}
        replayId={replayId}
        onEdit={onEdit}
        onRemoved={onRemoved}
      />
    </aside>
  )
}

/**
 * Amending and removing, the second in two steps.
 *
 * Removing is for good, photos included, so the button asks again in the
 * sheet itself rather than in a browser dialog that would stop the whole page.
 */
function Actions({
  report,
  replayId,
  onEdit,
  onRemoved,
}: {
  report: ReplayEvent
  replayId: string
  onEdit: () => void
  onRemoved: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const { remove, removing, failure } = useRemoving(replayId, report.id, onRemoved)

  return (
    <footer className="sheet-actions">
      {failure === undefined ? null : (
        <p className="refusal" role="alert">
          {failure}
        </p>
      )}
      {confirming ? (
        <Confirm
          removing={removing}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <>
          <button type="button" onClick={onEdit}>
            Modifier
          </button>
          <button type="button" className="quiet" onClick={() => setConfirming(true)}>
            Supprimer
          </button>
        </>
      )}
    </footer>
  )
}

/** Asking the API to remove it, and saying why it would not. */
function useRemoving(replayId: string, id: string, onRemoved: (id: string) => void) {
  const [removing, setRemoving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  async function remove(): Promise<void> {
    setRemoving(true)
    setFailure(undefined)
    try {
      await api.removeEvent(replayId, id)
      onRemoved(id)
    } catch (error) {
      setFailure(describe(error))
      setRemoving(false)
    }
  }

  return { remove, removing, failure }
}

function Confirm({
  removing,
  onConfirm,
  onCancel,
}: {
  removing: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <p>Supprimer définitivement cet événement et ses photos ?</p>
      <button type="button" className="danger" disabled={removing} onClick={onConfirm}>
        {removing ? 'Suppression…' : 'Confirmer la suppression'}
      </button>
      <button type="button" className="quiet" disabled={removing} onClick={onCancel}>
        Annuler
      </button>
    </>
  )
}

/** Its span in French time, or its instant alone when it lasted none. */
function whenOf(report: ReplayEvent): string {
  return report.to === null
    ? `Le ${formatInstant(report.from)}, heure française.`
    : `Du ${formatInstant(report.from)} au ${formatInstant(report.to)}, heure française.`
}

/**
 * The photos, small, and the one asked for at full width.
 *
 * Keyed on the event upstream, so a photo enlarged on one event is not the
 * one shown enlarged when another opens.
 */
function Photos({ paths, replayId, title }: { paths: string[]; replayId: string; title: string }) {
  const [enlarged, setEnlarged] = useState<string | undefined>(undefined)
  if (paths.length === 0) return null

  return (
    <>
      <ul className="photos">
        {paths.map((path, index) => (
          <li key={path}>
            <button
              type="button"
              aria-pressed={enlarged === path}
              onClick={() => {
                setEnlarged(enlarged === path ? undefined : path)
              }}
            >
              <img
                src={api.mediaUrl(replayId, path)}
                alt={`${title}, photo ${String(index + 1)}`}
                loading="lazy"
              />
            </button>
          </li>
        ))}
      </ul>
      {enlarged === undefined ? null : (
        <img className="enlarged" src={api.mediaUrl(replayId, enlarged)} alt={title} />
      )}
    </>
  )
}
