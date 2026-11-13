import { useState } from 'react'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { useAdmin } from '../admin.tsx'
import { api } from '../api.ts'
import { describe } from '../problems.ts'
import { formatInstant } from '../time.ts'

export type ReportSheetProps = {
  report: ReplayEvent
  replayId: string
  onEdit: () => void
  /** The API removed it: the screen lets it go, and the window with it. */
  onRemoved: (id: string) => void
}

/**
 * Everything an agent wrote of an event, in the window opened from the mark
 * that stands for it, under its title.
 */
export function ReportSheet({ report, replayId, onEdit, onRemoved }: ReportSheetProps) {
  const { signedIn } = useAdmin()

  return (
    <div className="sheet">
      <p className="when">{whenOf(report)}</p>
      <p className="note">Signalé par : {report.producerKind}</p>
      {report.description === null ? null : <p className="description">{report.description}</p>}
      {report.link === null ? null : <Link href={report.link} />}
      <Photos key={report.id} paths={report.media} replayId={replayId} title={report.title} />
      {signedIn === true ? (
        <Actions
          key={`actions-${report.id}`}
          report={report}
          replayId={replayId}
          onEdit={onEdit}
          onRemoved={onRemoved}
        />
      ) : null}
    </div>
  )
}

/**
 * Amending and removing, the second asked again in the sheet itself rather than
 * in a browser dialog that would stop the whole page.
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

/**
 * The site it leads to rather than the whole address, which may run to hundreds
 * of characters; the address itself shows on hovering.
 */
function Link({ href }: { href: string }) {
  return (
    <p className="note">
      Lien :{' '}
      <a href={href} title={href} target="_blank" rel="noopener noreferrer">
        {new URL(href).hostname}
      </a>
    </p>
  )
}

/** Its span in French time, or its instant alone when it lasted none. */
function whenOf(report: ReplayEvent): string {
  return report.to === null
    ? `Le ${formatInstant(report.from)}, heure française.`
    : `Du ${formatInstant(report.from)} au ${formatInstant(report.to)}, heure française.`
}

/**
 * The photos, small, and the one asked for at full width. Keyed on the event
 * upstream, so the enlarged photo never carries over to another event.
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
