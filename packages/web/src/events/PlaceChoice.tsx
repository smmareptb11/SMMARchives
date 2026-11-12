import type { EventPosition } from '@smmarchives/shared/contracts/event.ts'
import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'

import { useEffect, useRef, useState } from 'react'

import {
  drawingOf,
  pointAt,
  rectangleOf,
  type Mode,
  type Placed,
  type Placement,
  type Spot,
} from './placing.ts'

export type PlaceChoiceProps = {
  extent: BoundingBox
  value: EventPosition | null
  onChange: (position: EventPosition | null) => void
  refusal: string | undefined
  /** What the replay's map is asked to draw and to listen for, or nothing once the form is gone. */
  onPlacement: (placement: Placement | undefined) => void
  /** The event amended, if the form amends one: the map shows its place here alone. */
  amending: string | undefined
}

/**
 * Where the event happened: a spot, or an area spanned by two corners, on the
 * replay's own map.
 *
 * The agent starts placing and the map listens until the place is set or given
 * up: in between, a click on a station opens nothing, so the map that shows the
 * replay can also take the place of what happened in it.
 */
export function PlaceChoice({
  extent,
  value,
  onChange,
  refusal,
  onPlacement,
  amending,
}: PlaceChoiceProps) {
  const { mode, said, start } = usePlacing({ extent, value, onChange, onPlacement, amending })

  return (
    <fieldset className="place-choice">
      <legend>Lieu (facultatif)</legend>
      <p className="note">{statusOf(mode, value)}</p>
      <div className="place-actions">
        <button type="button" aria-pressed={mode === 'point'} onClick={() => start('point')}>
          Placer un point
        </button>
        <button type="button" aria-pressed={mode === 'area'} onClick={() => start('area')}>
          Tracer une zone
        </button>
        <button
          type="button"
          className="quiet"
          disabled={value === null}
          onClick={() => {
            onChange(null)
          }}
        >
          Effacer
        </button>
      </div>
      {(said ?? refusal) === undefined ? null : <span className="refused">{said ?? refusal}</span>}
    </fieldset>
  )
}

/**
 * What the map is handed while the form is open, and what it makes of a click.
 *
 * Published again whenever what it draws or how it listens changes, and taken
 * back once the form is gone, so the map never draws a place for no form.
 */
function usePlacing({
  extent,
  value,
  onChange,
  onPlacement,
  amending,
}: Omit<PlaceChoiceProps, 'refusal'>): {
  mode: Mode | undefined
  said: string | undefined
  start: (mode: Mode) => void
} {
  const [mode, setMode] = useState<Mode | undefined>(undefined)
  const [anchor, setAnchor] = useState<Spot | undefined>(undefined)
  const [said, setSaid] = useState<string | undefined>(undefined)
  // Read through a ref: the form hands a new function on every render, and the
  // map would otherwise be handed a new placement as often.
  const changed = useRef(onChange)
  changed.current = onChange

  useEffect(() => {
    const stop = () => {
      setMode(undefined)
      setAnchor(undefined)
    }
    const placed = (outcome: Placed) => {
      if ('refusal' in outcome) return setSaid(outcome.refusal)
      changed.current(outcome.position)
      stop()
    }
    // An area's first click sets a corner, its second the opposite one.
    const onSpot = (spot: Spot) => {
      setSaid(undefined)
      if (mode === 'point') placed(pointAt(spot, extent))
      else if (anchor === undefined) setAnchor(spot)
      else placed(rectangleOf(anchor, spot, extent))
    }

    onPlacement({
      drawing: drawingOf(extent, value, anchor),
      amending,
      listening: mode === undefined ? undefined : { mode, anchor, onSpot, onCancel: stop },
    })
  }, [extent, value, anchor, mode, onPlacement, amending])

  useEffect(() => () => onPlacement(undefined), [onPlacement])

  const start = (next: Mode) => {
    setSaid(undefined)
    setAnchor(undefined)
    setMode(next)
  }
  return { mode, said, start }
}

function statusOf(mode: Mode | undefined, value: EventPosition | null): string {
  if (mode !== undefined) return 'Placement en cours sur la carte.'
  if (value === null) return 'Sans lieu.'
  return value.type === 'Point' ? 'Point placé sur la carte.' : 'Zone placée sur la carte.'
}
