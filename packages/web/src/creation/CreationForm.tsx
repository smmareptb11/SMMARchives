import { useState } from 'react'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { api } from '../api.ts'
import { ApiError, describe, type ApiProblem } from '../problems.ts'
import { formatInstant, toInstant } from '../time.ts'
import { hoursBetween, periodOf } from './period.ts'

export type CreationFormProps = {
  onCreated: (manifest: ReplayManifest) => void
}

export function CreationForm({ onCreated }: CreationFormProps) {
  const [label, setLabel] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
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
      onCreated(await api.createReplay({ label: label.trim(), extent: null, ...asked }))
    } catch (error) {
      setRefusal(describe(error))
      // What the API refused, field by field, rather than one sentence for all.
      if (error instanceof ApiError) setRefusals(error.problem.refusals)
    } finally {
      setSending(false)
    }
  }

  const hours = hoursBetween(from, to)

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h1>Constituer un rejeu</h1>
      <p className="lead">
        Le rejeu couvre tout le territoire du SMMAR. Les heures sont en heure française.
      </p>

      <label>
        Titre
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>

      <div className="period">
        <HourField label="Début" value={from} onChange={setFrom} />
        <HourField label="Fin" value={to} onChange={setTo} />
      </div>

      {hours !== undefined && hours > 0 ? <p className="note">Durée : {hours} heures.</p> : null}

      <Refusal said={refusal} fields={refusals} />

      <button type="submit" disabled={sending}>
        {sending ? 'Construction lancée…' : 'Constituer'}
      </button>
    </form>
  )
}

type HourFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
}

/**
 * An hour of the French clock, and the instant it names said back underneath.
 *
 * That last line is the one place the change of clock becomes visible: two
 * o'clock on the last Sunday of October names two instants, and this says
 * which of them was taken.
 */
function HourField({ label, value, onChange }: HourFieldProps) {
  const instant = toInstant(value)

  return (
    <label>
      {label}
      <input
        type="datetime-local"
        step={3600}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {instant === undefined ? null : <small>{formatInstant(instant)}</small>}
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
