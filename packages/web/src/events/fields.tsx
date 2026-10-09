import { useEffect, useState } from 'react'

import type { EventProvenance } from '@smmarchives/shared/contracts/event.ts'
import type { Position } from '@smmarchives/shared/contracts/geometry.ts'

import type { ApiProblem } from '../problems.ts'
import { formatInstant } from '../time.ts'
import {
  endNamed,
  IMAGE_TYPES,
  PROVENANCES,
  startNamed,
  type Draft,
  type Refusals,
} from './draft.ts'
import { refusalsSaid } from './refusals.ts'

/** What the agent types, each field with what the form found wrong with it. */
export function DraftFields({
  draft,
  offered,
  onChange,
  refusals,
}: {
  draft: Draft
  /** The start the form opened with, which the start field names while it still says it. */
  offered: string
  onChange: (field: keyof Draft, value: string) => void
  refusals: Refusals
}) {
  return (
    <>
      <TitleField
        value={draft.title}
        onChange={(value) => onChange('title', value)}
        refusal={refusals.title}
      />

      <PeriodFields draft={draft} offered={offered} onChange={onChange} refusals={refusals} />

      <ProvenanceField
        value={draft.provenance}
        onChange={(value) => onChange('provenance', value)}
      />

      <label>
        Description
        <textarea
          rows={3}
          maxLength={4000}
          placeholder="Ce qui a été observé"
          value={draft.description}
          onChange={(event) => onChange('description', event.target.value)}
        />
      </label>
    </>
  )
}

function TitleField({
  value,
  onChange,
  refusal,
}: {
  value: string
  onChange: (value: string) => void
  refusal: string | undefined
}) {
  return (
    <label>
      Titre
      <input
        value={value}
        maxLength={120}
        placeholder="Ex. : Route inondée, D118"
        onChange={(event) => onChange(event.target.value)}
      />
      <Said refusal={refusal} />
    </label>
  )
}

function ProvenanceField({
  value,
  onChange,
}: {
  value: EventProvenance | ''
  onChange: (value: string) => void
}) {
  return (
    <label>
      Provenance de l'information
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Non précisée</option>
        {Object.entries(PROVENANCES).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The start and the end, each read as the form will send it. */
function PeriodFields({
  draft,
  offered,
  onChange,
  refusals,
}: {
  draft: Draft
  offered: string
  onChange: (field: keyof Draft, value: string) => void
  refusals: Refusals
}) {
  const from = startNamed(draft.from, offered)

  return (
    <div className="period">
      <MinuteField
        label="Début"
        value={draft.from}
        instant={from}
        onChange={(value) => onChange('from', value)}
        refusal={refusals.from}
      />
      <MinuteField
        label="Fin (facultative)"
        value={draft.to}
        instant={endNamed(draft.to, from)}
        onChange={(value) => onChange('to', value)}
        refusal={refusals.to}
        hint="Sans fin, l'événement est ponctuel et reste affiché une minute."
      />
    </div>
  )
}

/**
 * A minute of the French clock, and the instant it names said back underneath.
 *
 * That line is where the change of clock becomes visible: two o'clock on the
 * last Sunday of October names two instants, and this says which is sent.
 */
function MinuteField({
  label,
  value,
  instant,
  onChange,
  refusal,
  hint,
}: {
  label: string
  value: string
  /** The instant the form sends for what is typed, read as `draft.ts` reads it. */
  instant: string | undefined
  onChange: (value: string) => void
  refusal: string | undefined
  hint?: string
}) {
  return (
    <label>
      {label}
      <input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <small>{instant === undefined ? (hint ?? null) : formatInstant(instant)}</small>
      <Said refusal={refusal} />
    </label>
  )
}

/** The photograph, and a look at it before it is sent. */
export function ImageField({
  image,
  onChange,
  refusal,
}: {
  image: File | undefined
  onChange: (image: File | undefined) => void
  refusal: string | undefined
}) {
  const [preview, setPreview] = useState<string | undefined>(undefined)

  // An object URL holds the file in memory until it is revoked.
  useEffect(() => {
    if (image === undefined) return
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => {
      URL.revokeObjectURL(url)
      setPreview(undefined)
    }
  }, [image])

  return (
    <label>
      Photo (facultative)
      <input
        type="file"
        accept={IMAGE_TYPES.join(',')}
        onChange={(event) => onChange(event.target.files?.[0])}
      />
      {preview === undefined ? null : <img className="written-preview" src={preview} alt="" />}
      <Said refusal={refusal} />
    </label>
  )
}

/** Where the event stands, picked on the map by the agent's own request. */
export function Place({
  position,
  picking,
  onPick,
  onUnplace,
  refusal,
}: {
  position: Position | null
  picking: boolean
  onPick: (picking: boolean) => void
  onUnplace: () => void
  refusal: string | undefined
}) {
  return (
    <div className="place">
      <span className="place-name">Localisation</span>
      <span className="note">{placeSaid(position, picking)}</span>
      <button type="button" className="secondary" onClick={() => onPick(!picking)}>
        {picking ? 'Renoncer' : position === null ? 'Placer sur la carte' : 'Déplacer'}
      </button>
      {position === null || picking ? null : (
        <button type="button" className="secondary" onClick={onUnplace}>
          Retirer
        </button>
      )}
      <Said refusal={refusal} />
    </div>
  )
}

function placeSaid(position: Position | null, picking: boolean): string {
  if (picking) return "Cliquez sur la carte pour placer l'événement. Échap pour renoncer."
  if (position === null) return 'Sans localisation'
  return `${position.lat.toFixed(4)}, ${position.lon.toFixed(4)}`
}

function Said({ refusal }: { refusal: string | undefined }) {
  return refusal === undefined ? null : <small className="refused">{refusal}</small>
}

/** What the API refused, field by field, in French. */
export function Refusal({
  said,
  fields,
}: {
  said: string | undefined
  fields: ApiProblem['refusals']
}) {
  if (said === undefined) return null

  return (
    <div className="refusal" role="alert">
      {said}
      {fields === undefined ? null : (
        <ul>
          {refusalsSaid(fields).map((one, index) => (
            <li key={index}>{one}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
