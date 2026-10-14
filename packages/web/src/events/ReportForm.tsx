import { Suspense, lazy, useEffect, useMemo, useState, type FormEvent } from 'react'

import type { Instant, TimeWindow } from '@smmarchives/shared/clock.ts'
import type { EventPosition, ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'

import { api } from '../api.ts'
import { ApiError, describe } from '../problems.ts'
import { draftAt, judged, placed, toCorrect, touched, type Draft, type Refusals } from './draft.ts'
import { Fields } from './fields.tsx'
import { PhotoPicker } from './PhotoPicker.tsx'

/**
 * Loaded when the form opens, and not with the screen: MapLibre weighs a
 * megabyte, and the replay's own map already loads it apart for the same reason.
 */
const PositionPicker = lazy(async () => ({
  default: (await import('./PositionPicker.tsx')).PositionPicker,
}))

export type ReportFormProps = {
  replayId: string
  period: TimeWindow
  /** Where the event may be placed: the replay's extent, or the territory. */
  extent: BoundingBox
  /** Where the reading stood when the form was opened, which is where the event starts. */
  at: Instant
  /** Something asked to leave the form while it holds what the agent typed. */
  leaving: boolean
  onLeave: () => void
  onStay: () => void
  onCancel: () => void
  /** Whether closing it now would throw away what the agent typed. */
  onTouched: (touched: boolean) => void
  onReported: (event: ReplayEvent) => void
}

/** Reporting an event, in the panel the sheet opens in. */
export function ReportForm(props: ReportFormProps) {
  const blank = useMemo(() => draftAt(props.at), [props.at])
  const [draft, setDraft] = useState<Draft>(blank)
  const [photos, setPhotos] = useState<File[]>([])
  const sent = useSending(props, draft, photos)
  const { onTouched } = props

  useEffect(() => {
    onTouched(touched(draft, blank, photos.length))
  }, [draft, blank, photos.length, onTouched])

  const place = (position: EventPosition | null) => {
    setDraft((held) => ({ ...held, position }))
    sent.forget('position')
  }
  const edit = (field: keyof Draft) => (value: string) => {
    setDraft((held) => ({ ...held, [field]: value }))
    sent.forget(field)
  }

  return (
    <form className="sheet report-form" onSubmit={(event) => void sent.submit(event)}>
      <h2>Saisir un événement</h2>
      {props.leaving ? <Leaving onLeave={props.onLeave} onStay={props.onStay} /> : null}
      <Fields draft={draft} edit={edit} refusals={sent.refusals} />
      <Place
        extent={props.extent}
        value={draft.position}
        onChange={place}
        refusal={sent.refusals.position}
      />
      <PhotoPicker
        photos={photos}
        onChange={(next) => {
          setPhotos(next)
          sent.forget('photos')
        }}
        refusal={sent.refusals.photos}
      />
      <Ending
        failure={sent.failure}
        uncorrected={toCorrect(sent.refusals)}
        sending={sent.sending}
        onCancel={props.onCancel}
      />
    </form>
  )
}

/** What the API said against it, and the two ways out of the form. */
function Ending({
  failure,
  uncorrected,
  sending,
  onCancel,
}: {
  failure: readonly string[]
  /** The fields refused, named beside the button: their messages may be out of sight. */
  uncorrected: string | undefined
  sending: boolean
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
        <button type="submit" disabled={sending}>
          {sending ? 'Envoi…' : 'Enregistrer'}
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Annuler
        </button>
      </footer>
    </>
  )
}

/** The small map, once it has loaded. */
function Place(props: Parameters<typeof PositionPicker>[0]) {
  return (
    <Suspense fallback={<p className="note">Chargement de la carte…</p>}>
      <PositionPicker {...props} />
    </Suspense>
  )
}

/**
 * Judging the draft, sending it, and saying why it was refused.
 *
 * The form's own rules first, in French and beside each field; then the API's,
 * placed beside the field it names.
 */
function useSending(props: ReportFormProps, draft: Draft, photos: readonly File[]) {
  const [refusals, setRefusals] = useState<Refusals>({})
  const [failure, setFailure] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setFailure([])
    const verdict = judged(draft, props.period, photos)
    setRefusals('refusals' in verdict ? verdict.refusals : {})
    if ('refusals' in verdict) return

    setSending(true)
    try {
      props.onReported(await api.reportEvent(props.replayId, verdict.report, photos))
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

  return { submit, forget, refusals, failure, sending }
}

/** What the API refused, beside the fields it named, and the rest under the form. */
function refusalOf(error: unknown): { fields: Refusals; failure: string[] } {
  const said = error instanceof ApiError ? placed(error.problem.refusals ?? []) : undefined
  return { fields: said?.fields ?? {}, failure: [describe(error), ...(said?.rest ?? [])] }
}

/** Asked before what the agent typed is thrown away, and only then. */
function Leaving({ onLeave, onStay }: { onLeave: () => void; onStay: () => void }) {
  return (
    <div className="leaving" role="alert">
      <p>Abandonner la saisie en cours ?</p>
      <button type="button" onClick={onLeave}>
        Abandonner
      </button>
      <button type="button" className="quiet" onClick={onStay}>
        Continuer la saisie
      </button>
    </div>
  )
}
