import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import type { Instant, TimeWindow } from '@smmarchives/shared/clock.ts'
import type { EventPosition, ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'

import { api } from '../api.ts'
import { ApiError, describe } from '../problems.ts'
import {
  draftAt,
  draftOf,
  hoursRefused,
  judged,
  placed,
  toCorrect,
  touched,
  type Draft,
  type Refusals,
} from './draft.ts'
import { Fields } from './fields.tsx'
import { PhotoPicker } from './PhotoPicker.tsx'
import { PlaceChoice } from './PlaceChoice.tsx'
import type { Placement } from './placing.ts'

export type ReportFormProps = {
  replayId: string
  period: TimeWindow
  /** Where the event may be placed: the replay's extent, or the territory. */
  extent: BoundingBox
  /** What the replay's map is asked to draw and listen for while the form is open. */
  onPlacement: (placement: Placement | undefined) => void
  /** Where the reading stood when the form was opened, which is where a new event starts. */
  at: Instant
  /** The event being amended, or nothing to report a new one. */
  editing?: ReplayEvent | undefined
  /** Something asked to leave the form while it holds what the agent typed. */
  leaving: boolean
  onLeave: () => void
  onStay: () => void
  onCancel: () => void
  /** Whether closing it now would throw away what the agent typed. */
  onTouched: (touched: boolean) => void
  onReported: (event: ReplayEvent) => void
}

/**
 * Reporting an event, or amending one, in the right-hand column: one form,
 * blank from the reading's instant or filled in from the event.
 */
export function ReportForm(props: ReportFormProps) {
  const { editing, at, onTouched } = props
  const blank = useMemo(
    () => (editing === undefined ? draftAt(at) : draftOf(editing)),
    [editing, at],
  )
  const [draft, setDraft] = useState<Draft>(blank)
  const chosen = useChosenPhotos(editing, () => {
    sent.forget('photos')
  })
  const sent = useSending(props, draft, chosen)

  useEffect(() => {
    onTouched(touched(draft, blank, chosen.changed))
  }, [draft, blank, chosen.changed, onTouched])

  const place = (position: EventPosition | null) => {
    setDraft((held) => ({ ...held, position }))
    sent.forget('position')
  }
  const edit = (field: Exclude<keyof Draft, 'near'>) => (value: string) => {
    setDraft((held) => ({ ...held, [field]: value }))
    if (field === 'from' || field === 'to') sent.judgeHours({ ...draft, [field]: value })
    else sent.forget(field)
  }

  return (
    // The form judges what was typed, in its own words: the browser's check
    // would stop an hour outside the period with a bubble of its own instead.
    <form className="report-form" noValidate onSubmit={(event) => void sent.submit(event)}>
      <h2>{editing === undefined ? 'Ajouter un événement' : 'Modifier l’événement'}</h2>
      <Fields draft={draft} edit={edit} refusals={sent.refusals} period={props.period} />
      <PlaceChoice
        extent={props.extent}
        value={draft.position}
        onChange={place}
        refusal={sent.refusals.position}
        onPlacement={props.onPlacement}
        amending={editing?.id}
      />
      <PhotoPicker {...chosen.picker} replayId={props.replayId} refusal={sent.refusals.photos} />
      <Ending
        failure={sent.failure}
        uncorrected={toCorrect(sent.refusals)}
        sending={sent.sending}
        leaving={props.leaving}
        onLeave={props.onLeave}
        onStay={props.onStay}
        onCancel={props.onCancel}
      />
    </form>
  )
}

/**
 * What the API said against it, and the two ways out of the form.
 *
 * Asked whether to leave, it asks where the buttons were, as the sheet asks
 * before removing.
 */
function Ending({
  failure,
  uncorrected,
  sending,
  leaving,
  onLeave,
  onStay,
  onCancel,
}: {
  failure: readonly string[]
  /** The fields refused, named beside the button: their messages may be out of sight. */
  uncorrected: string | undefined
  sending: boolean
  leaving: boolean
  onLeave: () => void
  onStay: () => void
  onCancel: () => void
}) {
  return (
    <>
      {failure.map((one) => (
        <p className="refusal" role="alert" key={one}>
          {one}
        </p>
      ))}
      {uncorrected === undefined ? null : (
        <p className="refused" role="alert">
          {uncorrected}
        </p>
      )}
      <footer>
        {leaving ? (
          <Leaving onLeave={onLeave} onStay={onStay} />
        ) : (
          <>
            <button type="submit" disabled={sending}>
              {sending ? 'Envoi…' : 'Enregistrer'}
            </button>
            <button type="button" className="quiet" onClick={onCancel}>
              Annuler
            </button>
          </>
        )}
      </footer>
    </>
  )
}

/**
 * The photos of the form: the event's own that it keeps, and the files added.
 *
 * `changed` counts what leaving would lose — a file chosen, or a photo taken out.
 */
function useChosenPhotos(editing: ReplayEvent | undefined, onChange: () => void) {
  const [photos, setPhotos] = useState<File[]>([])
  const [kept, setKept] = useState<string[]>(editing?.media ?? [])

  return {
    photos,
    kept,
    changed: photos.length + (editing?.media.length ?? 0) - kept.length,
    picker: {
      photos,
      kept,
      onChange: (next: File[]) => {
        setPhotos(next)
        onChange()
      },
      onKeptChange: (next: string[]) => {
        setKept(next)
        onChange()
      },
    },
  }
}

/** Judging the draft by the form's rules, then the API's, and saying why it was refused. */
function useSending(
  props: ReportFormProps,
  draft: Draft,
  { photos, kept }: { photos: readonly File[]; kept: readonly string[] },
) {
  const [refusals, setRefusals] = useState<Refusals>({})
  const [failure, setFailure] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setFailure([])
    const verdict = judged(draft, props.period, photos, kept.length)
    setRefusals('refusals' in verdict ? verdict.refusals : {})
    if ('refusals' in verdict) return

    setSending(true)
    try {
      const { editing, replayId } = props
      props.onReported(
        editing === undefined
          ? await api.reportEvent(replayId, verdict.report, photos)
          : await api.amendEvent(replayId, editing.id, verdict.report, { kept, added: photos }),
      )
    } catch (error) {
      const refused = refusalOf(error)
      setRefusals(refused.fields)
      setFailure(refused.failure)
    } finally {
      setSending(false)
    }
  }

  /** What was refused of a field stops being said once the agent changes it. */
  function forget(field: keyof Refusals): void {
    setRefusals(({ [field]: _gone, ...kept }) => kept)
  }

  /** The start and the end judged again, the one moving the other's verdict. */
  function judgeHours(next: Draft): void {
    setRefusals(({ from: _from, to: _to, ...kept }) => ({
      ...kept,
      ...hoursRefused(next, props.period),
    }))
  }

  return { submit, forget, judgeHours, refusals, failure, sending }
}

/** What the API refused, beside the fields it named, and the rest under the form. */
function refusalOf(error: unknown): { fields: Refusals; failure: string[] } {
  const said = error instanceof ApiError ? placed(error.problem.refusals ?? []) : undefined
  return { fields: said?.fields ?? {}, failure: [describe(error), ...(said?.rest ?? [])] }
}

/**
 * Asked before what the agent typed is thrown away, and only then.
 *
 * A click outside the panel asks it too, wherever the form was scrolled to:
 * so it brings itself into view, and the keyboard onto staying.
 */
function Leaving({ onLeave, onStay }: { onLeave: () => void; onStay: () => void }) {
  const staying = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    staying.current?.scrollIntoView({ block: 'nearest' })
    staying.current?.focus({ preventScroll: true })
  }, [])

  return (
    <>
      <p role="alert">Abandonner la saisie en cours ?</p>
      <button type="button" onClick={onLeave}>
        Abandonner
      </button>
      <button type="button" className="quiet" ref={staying} onClick={onStay}>
        Continuer la saisie
      </button>
    </>
  )
}
