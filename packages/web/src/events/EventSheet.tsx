import { useEffect } from 'react'

import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { api } from '../api.ts'
import { formatInstant } from '../time.ts'
import { PROVENANCES } from './draft.ts'

/**
 * Everything an agent wrote of an event, opened from its lane or its marker.
 *
 * An event with no end says so in words: « ponctuel » is what it is, where the
 * minute the screen gives it is only how long it is drawn.
 */
export function EventSheet({
  event,
  replayId,
  notice,
  onClose,
}: {
  event: ReplayEvent
  replayId: string
  /** What went wrong while it was being stored, if anything did. */
  notice: string | undefined
  onClose: () => void
}) {
  useEscape(onClose)
  const image = event.media[0]

  return (
    <article className="sheet">
      <header>
        <h2>{event.title}</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Fermer
        </button>
      </header>
      {notice === undefined ? null : (
        <p className="refusal" role="alert">
          {notice}
        </p>
      )}
      <dl>
        <dt>Date</dt>
        <dd>
          {formatInstant(event.from)}
          {event.to === null ? ' · ponctuel' : ` → ${formatInstant(event.to)}`}
        </dd>
        <dt>Provenance</dt>
        <dd>{event.provenance === null ? 'Non précisée' : PROVENANCES[event.provenance]}</dd>
        <dt>Localisation</dt>
        <dd>
          {event.position === null
            ? 'Non localisé'
            : `${event.position.lat.toFixed(4)}, ${event.position.lon.toFixed(4)}`}
        </dd>
      </dl>
      {event.description === null ? null : <p className="description">{event.description}</p>}
      {image === undefined ? null : (
        <a href={api.mediaUrl(replayId, image)} target="_blank" rel="noreferrer">
          <img src={api.mediaUrl(replayId, image)} alt={event.title} />
        </a>
      )}
    </article>
  )
}

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
    }
  }, [onClose])
}
