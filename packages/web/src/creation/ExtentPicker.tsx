import 'maplibre-gl/dist/maplibre-gl.css'

import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import type { Perimeter } from '@smmarchives/shared/reference/perimeters.ts'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { BLANK, groundOf } from '../map/ground.ts'
import { FRAME } from './extent.ts'
import { basinMap, frameOn, listen, pickerOn, settle, type Picker } from './viewfinder.ts'

export type ExtentPickerProps = {
  onChange: (extent: BoundingBox | null) => void
  /** Whether the rectangle is moving, the extent it frames not yet told. */
  onMoving: (moving: boolean) => void
}

/**
 * A viewfinder over the map: what the rectangle frames is the extent.
 *
 * The rectangle holds still in the middle of the view, so zooming or moving the
 * map is how the extent is set. Drawn by the page over the map, it stays still
 * while the ground moves under it.
 *
 * A basin union is where the rectangle starts from, not what it is: the list
 * keeps the union picked when the map is then moved by hand.
 */
export function ExtentPicker({ onChange, onMoving }: ExtentPickerProps) {
  const [whole, setWhole] = useState(true)
  const [union, setUnion] = useState('')
  const { container, groundless, ready, picker } = useMountedPicker(onChange, onMoving)
  const unions = useUnions()

  function narrow(narrowed: boolean): void {
    if (picker.current === undefined) return
    picker.current.narrowed = narrowed
    setWhole(!narrowed)
    if (!narrowed) setUnion('')
    settle(picker.current)
  }

  function startFrom(code: string): void {
    const picked = unions.find((one) => one.code === code)
    if (picker.current === undefined || picked === undefined) return
    setUnion(code)
    setWhole(false)
    frameOn(picker.current, picked.bounds)
  }

  return (
    <fieldset className="extent">
      <legend>Emprise</legend>
      {groundless ? (
        <p className="note refusal">
          Fond de carte injoignable. La carte reste utilisable, le fond reste blanc.
        </p>
      ) : null}
      <ExtentView container={container} framed={!whole} />
      <p className="note">
        {whole
          ? 'Tout le territoire. « Réduire l’emprise » trace un rectangle sur la carte.'
          : 'Emprise réduite : seuls les stations, pluviomètres et webcams du rectangle seront rejoués. Zoomez ou déplacez la carte pour l’ajuster.'}
      </p>
      <UnionSelect
        unions={unions}
        value={union}
        disabled={!ready || unions.length === 0}
        onChange={startFrom}
      />
      <button type="button" disabled={!ready} onClick={() => narrow(whole)}>
        {whole ? 'Réduire l’emprise' : 'Tout le territoire'}
      </button>
    </fieldset>
  )
}

/** The map, and the rectangle over it while the extent is narrowed. */
function ExtentView({
  container,
  framed,
}: {
  container: RefObject<HTMLDivElement | null>
  framed: boolean
}) {
  return (
    <div className="extent-view">
      <div className="extent-map" ref={container} />
      {framed ? (
        <div
          className="extent-frame"
          style={{
            left: `${FRAME.left * 100}%`,
            top: `${FRAME.top * 100}%`,
            right: `${(1 - FRAME.right) * 100}%`,
            bottom: `${(1 - FRAME.bottom) * 100}%`,
          }}
        />
      ) : null}
    </div>
  )
}

type UnionSelectProps = {
  unions: readonly Perimeter[]
  value: string
  disabled: boolean
  onChange: (code: string) => void
}

function UnionSelect({ unions, value, disabled, onChange }: UnionSelectProps) {
  return (
    <label>
      Partir d’un syndicat
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="" disabled>
          Choisir un syndicat
        </option>
        {unions.map((one) => (
          <option key={one.code} value={one.code} title={one.name}>
            {one.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * The seven basin unions, by the name a list shows.
 *
 * Loaded apart: their outlines weigh more than the rest of the form, and the
 * map's chunk already carries them.
 */
function useUnions(): readonly Perimeter[] {
  const [unions, setUnions] = useState<readonly Perimeter[]>([])

  useEffect(() => {
    let left = false
    void import('@smmarchives/shared/reference/perimeters.ts').then(({ UNIONS }) => {
      if (left) return
      setUnions([...UNIONS].sort((one, other) => one.label.localeCompare(other.label, 'fr')))
    })
    return () => {
      left = true
    }
  }, [])

  return unions
}

/** Builds the map once, and tears it down once. */
function useMountedPicker(
  onChange: (extent: BoundingBox | null) => void,
  onMoving: (moving: boolean) => void,
): {
  container: RefObject<HTMLDivElement | null>
  groundless: boolean
  ready: boolean
  picker: RefObject<Picker | undefined>
} {
  const container = useRef<HTMLDivElement>(null)
  const picker = useRef<Picker | undefined>(undefined)
  // Read by MapLibre's listeners, bound once: the props of the render they were
  // bound in go stale as soon as the form renders again.
  const change = useRef(onChange)
  change.current = onChange
  const move = useRef(onMoving)
  move.current = onMoving
  const [groundless, setGroundless] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let map: MapLibreMap | undefined
    let left = false

    void groundOf().then((style) => {
      if (left || container.current === null) return
      setGroundless(style === BLANK)

      const created = (map = basinMap(container.current, style))
      created.once('styledata', () => {
        picker.current = pickerOn(created, change, move)
        listen(picker.current)
        setReady(true)
      })
    })

    return () => {
      left = true
      picker.current = undefined
      setReady(false)
      map?.remove()
    }
  }, [])

  return { container, groundless, ready, picker }
}
