import { useId } from 'react'

import type { Pill } from './pills.ts'

/** One choice among a few, as a pill of joined buttons: the Acycliq widget's control. */
export function PillPicker<T>({
  label,
  options,
  chosen,
  onPick,
  unavailable,
}: {
  label: string
  options: readonly Pill<T>[]
  chosen: T
  onPick: (value: T) => void
  /**
   * Why the choice is not offered, when it is not: the buttons are then
   * disabled, and the reason is what a pointer and a screen reader are told.
   */
  unavailable?: string | undefined
}) {
  const reason = useId()

  return (
    <div
      className="pills"
      role="group"
      aria-label={label}
      title={unavailable}
      aria-describedby={unavailable === undefined ? undefined : reason}
    >
      {options.map((one) => (
        <PillButton
          key={one.label}
          pill={one}
          chosen={one.value === chosen}
          offered={unavailable === undefined}
          onPick={onPick}
        />
      ))}
      {unavailable === undefined ? null : (
        <span id={reason} hidden>
          {unavailable}
        </span>
      )}
    </div>
  )
}

/** One button of the pill, told why it alone is disabled when it is. */
function PillButton<T>({
  pill,
  chosen,
  offered,
  onPick,
}: {
  pill: Pill<T>
  chosen: boolean
  /** Whether the pill as a whole is offered. */
  offered: boolean
  onPick: (value: T) => void
}) {
  const reason = useId()
  const button = (
    <button
      type="button"
      aria-pressed={chosen}
      disabled={!offered || pill.unavailable !== undefined}
      aria-describedby={pill.unavailable === undefined ? undefined : reason}
      onClick={() => {
        onPick(pill.value)
      }}
    >
      {pill.label}
    </button>
  )

  if (pill.unavailable === undefined) return button

  // A disabled button takes no pointer: its reason is held by what the hover
  // reaches instead, which is this wrapper and not the whole pill.
  return (
    <span title={pill.unavailable}>
      {button}
      <span id={reason} hidden>
        {pill.unavailable}
      </span>
    </span>
  )
}
