import { useEffect, useState } from 'react'

import { api } from '../api.ts'
import { PHOTO_TYPES } from './draft.ts'

export type PhotoPickerProps = {
  photos: File[]
  onChange: (photos: File[]) => void
  /** The photos an amended event already holds and keeps, by their paths. */
  kept: string[]
  onKeptChange: (kept: string[]) => void
  replayId: string
  refusal: string | undefined
}

/**
 * The photos chosen, seen before they are sent, each of which can be taken out.
 *
 * Chosen files add up rather than replace one another: a second pick in the
 * gallery of a phone is a second photo, not a change of mind about the first.
 */
export function PhotoPicker({
  photos,
  onChange,
  kept,
  onKeptChange,
  replayId,
  refusal,
}: PhotoPickerProps) {
  const previews = usePreviews(photos)

  return (
    <fieldset className="photo-picker">
      <legend>Photos</legend>
      <Thumbnails
        sources={kept.map((path) => api.mediaUrl(replayId, path))}
        said="Photo enregistrée"
        onRemove={(index) => {
          onKeptChange(kept.filter((_, at) => at !== index))
        }}
      />
      <input
        type="file"
        multiple
        accept={PHOTO_TYPES.join(',')}
        onChange={(event) => {
          onChange([...photos, ...(event.target.files ?? [])])
          // Emptied, so the same file chosen again is a change the input reports.
          event.target.value = ''
        }}
      />
      <Thumbnails
        sources={previews}
        said="Photo"
        onRemove={(index) => {
          onChange(photos.filter((_, at) => at !== index))
        }}
      />
      {refusal === undefined ? null : <span className="refused">{refusal}</span>}
    </fieldset>
  )
}

/** Photos in small, each of which can be taken out. */
function Thumbnails({
  sources,
  said,
  onRemove,
}: {
  sources: readonly string[]
  said: string
  onRemove: (index: number) => void
}) {
  if (sources.length === 0) return null

  return (
    <ul className="photos">
      {sources.map((src, index) => (
        <li key={src}>
          <img src={src} alt={`${said} ${String(index + 1)}`} />
          <button
            type="button"
            className="quiet"
            aria-label={`Retirer : ${said.toLowerCase()} ${String(index + 1)}`}
            onClick={() => {
              onRemove(index)
            }}
          >
            Retirer
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * An address the browser serves each file from, for as long as it is shown.
 *
 * Revoked when the list changes or the form goes: each one holds the whole file
 * in memory, and a phone's photo weighs megabytes.
 */
function usePreviews(photos: readonly File[]): string[] {
  const [urls, setUrls] = useState<string[]>([])

  useEffect(() => {
    const made = photos.map((one) => URL.createObjectURL(one))
    setUrls(made)
    return () => {
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [photos])

  return urls
}
