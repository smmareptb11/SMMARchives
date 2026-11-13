import { useRef, useState } from 'react'

import type { ReplayAbout, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { PHENOMENA, SEVERITIES, type Choice } from '../about.ts'
import { api } from '../api.ts'
import { ApiError, describe, type ApiProblem } from '../problems.ts'
import { readBack } from '../time.ts'
import { ExtentPicker } from './ExtentPicker.tsx'
import type { Framing } from './viewfinder.ts'
import { endOnOpening, hoursBetween, lengthWarning, periodOf } from './period.ts'

export type CreationFormProps = {
  onCreated: (manifest: ReplayManifest) => void
}

export function CreationForm({ onCreated }: CreationFormProps) {
  const [label, setLabel] = useState('')
  const [about, setAbout] = useState<ReplayAbout>({})
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const end = useProposedEnd(from, to, setTo)
  const [framing, setFraming] = useState<Framing>({ extent: null })
  const [moving, setMoving] = useState(false)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const [refusals, setRefusals] = useState<ApiProblem['refusals']>(undefined)
  const [sending, setSending] = useState(false)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setRefusal(undefined)
    setRefusals(undefined)

    if (label.trim() === '') return setRefusal('Le titre nomme le rejeu.')
    const asked = periodOf(from, to)
    if ('refusal' in asked) return setRefusal(asked.refusal)

    setSending(true)
    try {
      onCreated(await api.createReplay({ label: label.trim(), ...framing, ...asked, ...about }))
    } catch (error) {
      setRefusal(describe(error))
      // What the API refused, field by field, rather than one sentence for all.
      if (error instanceof ApiError) setRefusals(error.problem.refusals)
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h1>Constituer un rejeu</h1>
      <p className="lead">
        Par défaut, le rejeu couvre tout le territoire. Les heures sont en heure française.
      </p>

      <label>
        Titre
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <AboutFields about={about} onChange={setAbout} />

      <div className="period">
        <HourField label="Début" value={from} onChange={setFrom} />
        <HourField label="Fin" value={to} min={from} {...end} />
      </div>

      <Length from={from} to={to} />

      <ExtentPicker onChange={setFraming} onMoving={setMoving} />

      <Refusal said={refusal} fields={refusals} />

      <Submit sending={sending} moving={moving} />
    </form>
  )
}

/**
 * What the administrator says of the replay, each optional: an empty choice
 * or an empty description is left out of the request rather than sent.
 */
function AboutFields({
  about,
  onChange,
}: {
  about: ReplayAbout
  onChange: (about: ReplayAbout) => void
}) {
  const { description, phenomenon, severity } = about
  const set = <K extends keyof ReplayAbout>(key: K, value: NonNullable<ReplayAbout[K]> | '') => {
    const next = { ...about }
    if (value === '') delete next[key]
    else next[key] = value
    onChange(next)
  }

  return (
    <>
      <div className="choices">
        <ChoiceField
          label="Type de phénomène"
          choices={PHENOMENA}
          value={phenomenon}
          onChange={(value) => set('phenomenon', value)}
        />
        <ChoiceField
          label="Gravité"
          choices={SEVERITIES}
          value={severity}
          onChange={(value) => set('severity', value)}
        />
      </div>
      <label>
        <span>
          Description <small>facultatif</small>
        </span>
        <textarea
          rows={4}
          maxLength={2000}
          value={description ?? ''}
          onChange={(event) => set('description', event.target.value)}
        />
      </label>
    </>
  )
}

/** One optional choice in a closed list: the empty option is no choice at all. */
function ChoiceField<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string
  choices: readonly Choice<T>[]
  value: T | undefined
  onChange: (value: T | '') => void
}) {
  return (
    <label>
      <span>
        {label} <small>facultatif</small>
      </span>
      <select
        value={value ?? ''}
        className={value === undefined ? 'unset' : undefined}
        onChange={(event) => onChange(event.target.value as T | '')}
      >
        <option value="">Non précisé</option>
        {choices.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Held while the map moves: the extent the form holds is the one framed before
 * the move, until the map rests.
 */
function Submit({ sending, moving }: { sending: boolean; moving: boolean }) {
  return (
    <button type="submit" disabled={sending || moving}>
      {sending ? 'Construction lancée…' : 'Constituer'}
    </button>
  )
}

type HourFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  /** The earliest hour the picker offers: an end never comes before its start. */
  min?: string
  onClick?: () => void
  onBlur?: () => void
}

/**
 * The end proposed as it is opened, so that the picker opens on the start, and
 * taken back if left as proposed: a field only opened is not one filled.
 */
function useProposedEnd(from: string, to: string, setTo: (value: string) => void) {
  const proposed = useRef<string | undefined>(undefined)

  return {
    onChange: (value: string) => {
      proposed.current = undefined
      setTo(value)
    },
    onClick: () => {
      const opening = endOnOpening(from, to)
      if (opening === to) return
      proposed.current = opening
      setTo(opening)
    },
    onBlur: () => {
      if (proposed.current !== undefined && proposed.current === to) setTo('')
      proposed.current = undefined
    },
  }
}

/** An hour of the French clock, and what it is read as when that is not what was typed. */
function HourField({ label, value, onChange, min, onClick, onBlur }: HourFieldProps) {
  const said = readBack(value)

  return (
    <label>
      {label}
      <input
        type="datetime-local"
        value={value}
        min={min === '' ? undefined : min}
        onChange={(event) => onChange(event.target.value)}
        onClick={onClick}
        onBlur={onBlur}
      />
      {said === undefined ? null : <small>{said}</small>}
    </label>
  )
}

/** What was refused, and by whom: this form, or the API, field by field. */
function Refusal({ said, fields }: { said: string | undefined; fields: ApiProblem['refusals'] }) {
  if (said === undefined) return null

  return (
    <p className="refusal" role="alert">
      {said}
      {fields === undefined ? null : (
        <ul>
          {fields.map((one) => (
            <li key={one.path}>
              {one.path} : {one.message}
            </li>
          ))}
        </ul>
      )}
    </p>
  )
}

/** How long the replay would cover, and a word when that is long. */
function Length({ from, to }: { from: string; to: string }) {
  const hours = hoursBetween(from, to)
  const warning = lengthWarning(from, to)
  if (hours === undefined || hours <= 0) return null

  return (
    <>
      <p className="note">Durée : {hours} heures.</p>
      {warning === undefined ? null : <p className="note warning">{warning}</p>}
    </>
  )
}
