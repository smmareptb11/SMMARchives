import { useId, useState } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'

import { readBack, toLocalInput, toLocalInputFrom } from '../time.ts'
import { endOnEntry, PRODUCER_KINDS, type Draft, type Refusals } from './draft.ts'

/** What the agent writes of the event, each field with what was refused of it. */
export function Fields({
  draft,
  edit,
  refusals,
  period,
}: {
  draft: Draft
  edit: (field: Exclude<keyof Draft, 'near'>) => (value: string) => void
  refusals: Refusals
  /** The replay's period, which the hours cannot be picked outside of. */
  period: TimeWindow
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
      <Hours draft={draft} edit={edit} refusals={refusals} period={period} />
      <TextField
        label="Description"
        value={draft.description}
        onChange={edit('description')}
        refusal={refusals.description}
        multiline
      />
      <TextField label="Lien" value={draft.link} onChange={edit('link')} refusal={refusals.link} />
    </>
  )
}

/**
 * The start, and the end beside it, asked for rather than offered:
 * most events an agent reports last no time at all, and an empty field under
 * the start reads as one left to fill.
 *
 * The end is shown from the start for an event that already has one. Taken
 * away, it is emptied with it, so an end the agent removed is never sent.
 */
function Hours({
  draft,
  edit,
  refusals,
  period,
}: {
  draft: Draft
  edit: (field: Exclude<keyof Draft, 'near'>) => (value: string) => void
  refusals: Refusals
  period: TimeWindow
}) {
  const [asked, setAsked] = useState(draft.to !== '')
  // The picker offers no hour outside the replay. Typed in, one still reaches
  // the draft, and the form refuses it as the API would.
  const within = { min: toLocalInputFrom(period.from), max: toLocalInput(period.to) }

  return (
    <div className="hour-row">
      <HourField
        {...within}
        label="Début"
        value={draft.from}
        onChange={edit('from')}
        refusal={refusals.from}
      />
      {asked ? (
        <EndField
          {...within}
          value={draft.to}
          onChange={edit('to')}
          refusal={refusals.to}
          onRemove={() => {
            edit('to')('')
            setAsked(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="quiet"
          onClick={() => {
            edit('to')(endOnEntry(draft))
            setAsked(true)
          }}
        >
          + Ajouter une fin
        </button>
      )}
    </div>
  )
}

/** The end, once asked for, and the way to take it back under it. */
function EndField({
  onRemove,
  ...field
}: Omit<TextFieldProps, 'label' | 'multiline'> & {
  min: string
  max: string
  onRemove: () => void
}) {
  return (
    <div className="end">
      <HourField {...field} label="Fin" />
      <button type="button" className="quiet" onClick={onRemove}>
        Retirer la fin
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

/** An hour of the French clock, and what it is read as when that is not what was typed. */
function HourField({
  label,
  value,
  onChange,
  refusal,
  min,
  max,
}: Omit<TextFieldProps, 'multiline'> & { min: string; max: string }) {
  const said = readBack(value)

  return (
    <label>
      {label}
      <input
        type="datetime-local"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
      {said === undefined ? null : <small>{said}</small>}
      <Refused said={refusal} />
    </label>
  )
}

function Refused({ said }: { said: string | undefined }) {
  return said === undefined ? null : <span className="refused">{said}</span>
}
