import { useEffect, useState } from 'react'

import { PHOTO_TYPES } from './draft.ts'

export type PhotoPickerProps = {
  photos: File[]
  onChange: (photos: File[]) => void
  refusal: string | undefined
}

/**
 * The photos chosen, seen before they are sent, each of which can be taken out.
 *
 * Chosen files add up rather than replace one another: a second pick in the
 * gallery of a phone is a second photo, not a change of mind about the first.
 */
export function PhotoPicker({ photos, onChange, refusal }: PhotoPickerProps) {
  const previews = usePreviews(photos)

  return (
    <fieldset className="photo-picker">
      <legend>Photos</legend>
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
      {previews.length === 0 ? null : (
        <ul className="photos">
          {previews.map((src, index) => (
            <li key={src}>
              <img src={src} alt={`Photo ${String(index + 1)}`} />
              <button
                type="button"
                className="quiet"
                aria-label={`Retirer la photo ${String(index + 1)}`}
                onClick={() => {
                  onChange(photos.filter((_, kept) => kept !== index))
                }}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
      {refusal === undefined ? null : <span className="refused">{refusal}</span>}
    </fieldset>
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
