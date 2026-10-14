import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'

import type { Instant, TimeWindow } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'

import { api } from '../api.ts'
import { ApiError, describe } from '../problems.ts'
import { formatInstant, toInstant } from '../time.ts'
import {
  draftAt,
  endOnEntry,
  judged,
  placed,
  PRODUCER_KINDS,
  touched,
  type Draft,
  type Refusals,
} from './draft.ts'
import { PhotoPicker } from './PhotoPicker.tsx'

export type ReportFormProps = {
  replayId: string
  period: TimeWindow
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

  const edit = (field: keyof Draft) => (value: string) => {
    setDraft((held) => ({ ...held, [field]: value }))
    sent.forget(field)
  }

  return (
    <form className="sheet report-form" onSubmit={(event) => void sent.submit(event)}>
      <h2>Saisir un événement</h2>
      {props.leaving ? <Leaving onLeave={props.onLeave} onStay={props.onStay} /> : null}
      <Fields draft={draft} edit={edit} refusals={sent.refusals} />
      <PhotoPicker
        photos={photos}
        onChange={(next) => {
          setPhotos(next)
          sent.forget('photos')
        }}
        refusal={sent.refusals.photos}
      />
      {sent.failure.map((one) => (
        <p className="refusal" role="alert" key={one}>
          {one}
        </p>
      ))}
      <footer>
        <button type="submit" disabled={sent.sending}>
          {sent.sending ? 'Envoi…' : 'Enregistrer'}
        </button>
        <button type="button" className="quiet" onClick={props.onCancel}>
          Annuler
        </button>
      </footer>
    </form>
  )
}

/** What the agent writes of the event, each field with what was refused of it. */
function Fields({
  draft,
  edit,
  refusals,
}: {
  draft: Draft
  edit: (field: keyof Draft) => (value: string) => void
  refusals: Refusals
}) {
  return (
    <>
      <TextField
        label="Titre"
        value={draft.title}
        onChange={edit('title')}
        refusal={refusals.title}
      />
      <TextField
        label="Signalé par"
        value={draft.producerKind}
        onChange={edit('producerKind')}
        refusal={refusals.producerKind}
        suggestions={PRODUCER_KINDS}
      />
      <HourField label="Début" value={draft.from} onChange={edit('from')} refusal={refusals.from} />
      <HourField
        label="Fin (facultative)"
        value={draft.to}
        onChange={edit('to')}
        refusal={refusals.to}
        onClick={() => {
          edit('to')(endOnEntry(draft))
        }}
      />
      <TextField
        label="Description"
        value={draft.description}
        onChange={edit('description')}
        refusal={refusals.description}
        multiline
      />
    </>
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

type TextFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  refusal: string | undefined
  multiline?: boolean
  suggestions?: readonly string[]
}

function TextField({ label, value, onChange, refusal, multiline, suggestions }: TextFieldProps) {
  const id = useId()
  const list = suggestions === undefined ? undefined : id

  return (
    <label>
      {label}
      {multiline === true ? (
        <textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} list={list} onChange={(event) => onChange(event.target.value)} />
      )}
      {list === undefined ? null : (
        <datalist id={list}>
          {suggestions?.map((one) => (
            <option key={one} value={one} />
          ))}
        </datalist>
      )}
      <Refused said={refusal} />
    </label>
  )
}

/**
 * An hour of the French clock, and the instant it names said back underneath —
 * the one place the change of clock becomes visible, as on the creation form.
 */
function HourField({
  label,
  value,
  onChange,
  refusal,
  onClick,
}: Omit<TextFieldProps, 'multiline'> & { onClick?: () => void }) {
  const instant = toInstant(value)

  return (
    <label>
      {label}
      <input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onClick={onClick}
      />
      <small>{instant === undefined ? null : formatInstant(instant)}</small>
      <Refused said={refusal} />
    </label>
  )
}

function Refused({ said }: { said: string | undefined }) {
  return said === undefined ? null : <span className="refused">{said}</span>
}
