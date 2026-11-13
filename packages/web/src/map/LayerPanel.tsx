import { memo, useMemo } from 'react'

import { MUTES } from '../mutes.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { familiesOf, NAMES, swatchColourOf, type Family, type Shown } from './families.ts'
import { isShape, swatchOf } from './symbols.ts'

/**
 * The legend, and the switch that cuts a family off: one panel, since both answer
 * what a shape is. What a switch does to the map is `MapView`'s business.
 */
export const LayerPanel = memo(function LayerPanel({
  content,
  shown,
  onChange,
  mutesShown,
  onMutesShown,
  heldBack,
}: {
  content: ReplayContent
  shown: Shown
  onChange: (shown: Shown) => void
  mutesShown: boolean
  onMutesShown: (shown: boolean) => void
  /** How many sources the switch holds back, on the map and on the lanes. */
  heldBack: number
}) {
  const families = useMemo(() => familiesOf(content), [content])
  if (families.length === 0) return null

  return (
    <fieldset className="layers">
      <legend>Couches</legend>
      {families.map((family) => (
        <Row
          key={family}
          family={family}
          shown={shown[family]}
          onChange={(one) => {
            onChange({ ...shown, [family]: one })
          }}
        />
      ))}
      <Mutes count={heldBack} shown={mutesShown} onChange={onMutesShown} />
    </fieldset>
  )
})

/**
 * The switch on the sources the replay holds nothing of, with their count: what
 * it hides would otherwise leave the map in silence.
 */
function Mutes({
  count,
  shown,
  onChange,
}: {
  count: number
  shown: boolean
  onChange: (shown: boolean) => void
}) {
  if (count === 0) return null

  return (
    <div className="mutes">
      <label>
        <input
          type="checkbox"
          checked={shown}
          onChange={(event) => {
            onChange(event.target.checked)
          }}
        />
        {MUTES} ({count})
      </label>
    </div>
  )
}

function Row({
  family,
  shown,
  onChange,
}: {
  family: Family
  shown: boolean
  onChange: (shown: boolean) => void
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={shown}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      <Swatch family={family} />
      {NAMES[family].many}
    </label>
  )
}

/** The mark of a family, from `map/symbols.ts` for the shapes it draws. */
function Swatch({ family }: { family: Family }) {
  const drawn = useMemo(
    () => (isShape(family) ? swatchOf(family, swatchColourOf(family)) : undefined),
    [family],
  )

  if (drawn === undefined) return <span className={`swatch ${family}`} />
  return <img className="swatch" src={drawn} alt="" />
}
