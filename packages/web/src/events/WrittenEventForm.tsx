import { useEffect, useState } from 'react'

import type { Instant } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { Position } from '@smmarchives/shared/contracts/geometry.ts'

import { api } from '../api.ts'
import { ApiError, type ApiProblem } from '../problems.ts'
import { toLocalInput } from '../time.ts'
import {
  EMPTY_DRAFT,
  eventOf,
  imageRefusal,
  imageRefusedSaid,
  type Draft,
  type Refusals,
  type Scope,
} from './draft.ts'
import { DraftFields, ImageField, Place, Refusal } from './fields.tsx'
import { eventRefusedSaid } from './refusals.ts'

export type WrittenEventFormProps = {
  replayId: string
  /** The period and the extent the event must fall within. */
  scope: Scope
  /** The instant the reading stood at when the form opened, which is the start it offers. */
  startsAt: Instant
  /** The place picked on the map, which the map holds since it is where it is picked. */
  position: Position | null
  picking: boolean
  onPick: (picking: boolean) => void
  onUnplace: () => void
  onCancel: () => void
  /** The event as stored, and what went wrong with its image, if anything did. */
  onAdded: (event: ReplayEvent, notice?: string) => void
}

/**
 * What an agent writes of an event: a title and a start, and what else they know.
 *
 * The hours are French time, typed on the replay's own clock, as every hour
 * the interface shows.
 */
export function WrittenEventForm(props: WrittenEventFormProps) {
  // Held from the opening: the reading may move while the form is open, and
  // the start offered is the one the field was filled with.
  const [offered] = useState(props.startsAt)
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT, from: toLocalInput(offered) })
  const [image, setImage] = useState<File | undefined>(undefined)
  const sent = useSubmission(props, offered)
  useEscapeFromPicking(props.picking, props.onPick)

  return (
    <form
      className="written-form"
      onSubmit={(event) => {
        event.preventDefault()
        void sent.submit({ ...draft, position: props.position }, image)
      }}
    >
      <h2>Nouvel événement</h2>
      <p className="note">Seuls le titre et la date de début sont obligatoires.</p>

      <DraftFields
        draft={draft}
        offered={offered}
        onChange={(field, value) => setDraft((held) => ({ ...held, [field]: value }))}
        refusals={sent.refusals}
      />
      <ImageField image={image} onChange={setImage} refusal={sent.refusals.image} />
      <Place
        position={props.position}
        picking={props.picking}
        onPick={props.onPick}
        onUnplace={props.onUnplace}
        refusal={sent.refusals.position}
      />

      <Refusal said={sent.refusal} fields={sent.fields} />

      <div className="actions">
        <button type="button" className="secondary" onClick={props.onCancel}>
          Annuler
        </button>
        <button type="submit" disabled={sent.sending}>
          {sent.sending ? 'Enregistrement…' : 'Ajouter'}
        </button>
      </div>
    </form>
  )
}

/**
 * Checks the draft, then sends the event and its image, in that order.
 *
 * What the form can see is refused before anything is sent; what only the API
 * knows comes back from it, field by field, as the creation form says it.
 */
function useSubmission(props: WrittenEventFormProps, offered: Instant) {
  const limit = useImageLimit()
  const [refusals, setRefusals] = useState<Refusals & { image?: string }>({})
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const [fields, setFields] = useState<ApiProblem['refusals']>(undefined)
  const [sending, setSending] = useState(false)

  async function submit(draft: Draft, image: File | undefined): Promise<void> {
    setRefusal(undefined)
    setFields(undefined)

    const checked = eventOf(draft, props.scope, offered)
    const imageSaid = image === undefined ? undefined : imageRefusal(image, limit)
    const found = 'refusals' in checked ? checked.refusals : {}
    setRefusals({ ...found, ...(imageSaid === undefined ? {} : { image: imageSaid }) })
    if ('refusals' in checked || imageSaid !== undefined) return

    setSending(true)
    try {
      const added = await api.addEvent(props.replayId, checked.event)
      props.onAdded(...(await withImage(props.replayId, added, image)))
    } catch (error) {
      setRefusal(eventRefusedSaid(error))
      if (error instanceof ApiError) setFields(error.problem.refusals)
      setSending(false)
    }
  }

  return { submit, refusals, refusal, fields, sending }
}

/**
 * The event with its image, or the event alone and why.
 *
 * The event is stored by then, so a refused image does not undo it: the agent
 * is told, and the event is there to be read.
 */
async function withImage(
  replayId: string,
  added: ReplayEvent,
  image: File | undefined,
): Promise<[ReplayEvent, string?]> {
  if (image === undefined) return [added]
  try {
    return [await api.attachImage(replayId, added.id, image)]
  } catch (error) {
    const status = error instanceof ApiError ? error.problem.status : undefined
    return [
      added,
      `L'événement est enregistré, mais l'image n'a pas été jointe : ${imageRefusedSaid(status)}`,
    ]
  }
}

/**
 * The heaviest image the API takes, once it has said so.
 *
 * Unknown until then, or if it never answers: the form then lets the image go,
 * and the API refuses it itself.
 */
function useImageLimit(): number | undefined {
  const [limit, setLimit] = useState<number | undefined>(undefined)

  useEffect(() => {
    let left = false
    api.limits().then(
      (limits) => {
        if (!left) setLimit(limits.manualImageBytes)
      },
      () => {},
    )
    return () => {
      left = true
    }
  }, [])

  return limit
}

/** Escape gives up picking a place, and does not close the form. */
function useEscapeFromPicking(picking: boolean, onPick: (picking: boolean) => void): void {
  useEffect(() => {
    if (!picking) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onPick(false)
    }
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
    }
  }, [picking, onPick])
}
