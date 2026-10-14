import { useEffect, useRef, useState } from 'react'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { api } from '../api.ts'
import { formatInstant } from '../time.ts'

export type ReportSheetProps = {
  report: ReplayEvent
  replayId: string
  onClose: () => void
}

/**
 * Everything an agent wrote of an event, opened from the mark that stands for it.
 *
 * Opened and closed by the reader alone: nothing the cursor or the map does
 * takes it away, so what one is reading stays there while the replay plays.
 */
export function ReportSheet({ report, replayId, onClose }: ReportSheetProps) {
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
    </aside>
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
