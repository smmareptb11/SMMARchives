import { useId } from 'react'

import { formatInstant, toInstant } from '../time.ts'
import { endOnEntry, PRODUCER_KINDS, type Draft, type Refusals } from './draft.ts'

/** What the agent writes of the event, each field with what was refused of it. */
export function Fields({
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
