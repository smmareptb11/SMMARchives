import { UNITS } from '@smmarchives/shared'

import { memo, useMemo } from 'react'

import { MUTES } from '../mutes.ts'
import { labelOf, productsOf } from '../radar.ts'
import { SHADES, UNMEASURED } from '../rain.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { familiesOf, NAMES, swatchColourOf, type Family, type Shown } from './families.ts'
import { isKind } from './sources.ts'
import { swatchOf } from './symbols.ts'

/**
 * The legend, and the switch that cuts a family off.
 *
 * One panel for both, because they answer the same question from two sides: a
 * reader looking for what a shape means, and a reader with three hundred of
 * them in one valley who wants some gone. What a switch does to the map is
 * `MapView`'s business; this one only says which families there are to cut.
 */
export const LayerPanel = memo(function LayerPanel({
  content,
  shown,
  onChange,
  mutesShown,
  onMutesShown,
  heldBack,
  product,
  onProduct,
}: {
  content: ReplayContent
  shown: Shown
  onChange: (shown: Shown) => void
  mutesShown: boolean
  onMutesShown: (shown: boolean) => void
  /** How many sources the switch holds back, on the map and on the lanes. */
  heldBack: number
  product: string | undefined
  onProduct: (product: string) => void
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
      {families.includes('radar') ? (
        <Products content={content} product={product} onChange={onProduct} />
      ) : null}
      <Mutes count={heldBack} shown={mutesShown} onChange={onMutesShown} />
      {families.includes('rain-gauge') ? <RainRamp /> : null}
    </fieldset>
  )
})

/**
 * Which of the delivered cumuls the map draws, under the row that lights it.
 *
 * Live whether the layer is lit or not: it commands the lane under the map as
 * well, and a five-minute cumul and a twenty-four-hour one are two readings of
 * the same episode rather than two settings of one.
 *
 * The products come from the delivery and never from a list here — the documentation
 * requires it, the live route serving eight of the nine a delivery carries.
 */
function Products({
  content,
  product,
  onChange,
}: {
  content: ReplayContent
  product: string | undefined
  onChange: (product: string) => void
}) {
  const products = useMemo(() => productsOf(content.series), [content.series])

  return (
    <select
      className="products"
      aria-label="Cumul des lames d'eau"
      value={product ?? ''}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    >
      {products.map((one) => (
        <option key={one} value={one}>
          {labelOf(one)}
        </option>
      ))}
    </select>
  )
}

/**
 * The switch on the sources the replay holds nothing of, and its own limit.
 *
 * The count is on the switch itself: what it hides leaves the map in silence
 * otherwise, and a reader has no way of knowing there was anything to ask for.
 *
 * The sentence beside it is the switch's scope and not a caveat. A station is
 * held back for having crossed no threshold, which is not the same as having
 * measured nothing — its measures are the nineteen megabytes this screen does
 * not load, and nothing here can tell one from the other.
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
      <span className="mutes-scope">
        Pour une station, cela veut dire aucun franchissement : cet écran ne charge pas ses mesures.
      </span>
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

/** The mark of a family, from `map/symbols.ts` for the three it draws. */
function Swatch({ family }: { family: Family }) {
  const drawn = useMemo(
    () => (isKind(family) ? swatchOf(family, swatchColourOf(family)) : undefined),
    [family],
  )

  if (drawn === undefined) return <span className={`swatch ${family}`} />
  return <img className="swatch" src={drawn} alt="" />
}

/**
 * The scale the blue of a rain gauge is read on, and the grey beside it.
 *
 * Here rather than in a legend of its own: the panel is already where a reader
 * comes to learn what the map means, and the two languages of colour it now
 * speaks are easiest to tell apart when they are named side by side.
 *
 * The bounds alone, the unit said once: a ramp that darkens from left to right
 * says « from » without a word for it, and six ranges written out would take
 * more room than the families above them.
 */
function RainRamp() {
  return (
    <div className="ramp">
      <span className="ramp-name">Pluie cumulée ({UNITS.rainfall})</span>
      {[
        ...SHADES.map((shade) => ({ colour: shade.colour, said: String(shade.from) })),
        { colour: UNMEASURED, said: 'aucune mesure' },
      ].map((mark) => (
        <span key={mark.colour}>
          <i className="swatch" style={{ background: mark.colour }} />
          {mark.said}
        </span>
      ))}
    </div>
  )
}
