import 'maplibre-gl/dist/maplibre-gl.css'

import type { Perimeter } from '@smmarchives/shared/reference/perimeters.ts'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { BLANK, groundOf } from '../map/ground.ts'
import { FRAME } from './extent.ts'
import {
  basinMap,
  frameOn,
  listen,
  pickerOn,
  settle,
  type Framed,
  type Picker,
} from './viewfinder.ts'

type ExtentPickerProps = {
  onChange: Framed
  /** Whether the rectangle is moving, the extent it frames not yet told. */
  onMoving: (moving: boolean) => void
}

/**
 * A viewfinder over the map: what the rectangle frames is the extent. A basin
 * union is where the rectangle starts from, not what it is: the list keeps the
 * union picked when the map is then moved by hand.
 */
export function ExtentPicker({ onChange, onMoving }: ExtentPickerProps) {
  const [whole, setWhole] = useState(true)
  const [union, setUnion] = useState('')
  const [named, setNamed] = useState<string | undefined>(undefined)
  const framed: Framed = (framing) => {
    setNamed(framing.territory)
    onChange(framing)
  }
  const { container, groundless, ready, picker } = useMountedPicker(framed, onMoving)
  const unions = useUnions()

  function narrow(narrowed: boolean): void {
    if (picker.current === undefined) return
    picker.current.narrowed = narrowed
    picker.current.territory = undefined
    setWhole(!narrowed)
    if (!narrowed) setUnion('')
    settle(picker.current)
  }

  function startFrom(code: string): void {
    const picked = unions.find((one) => one.code === code)
    if (picker.current === undefined || picked === undefined) return
    setUnion(code)
    setWhole(false)
    frameOn(picker.current, picked.bounds, picked.label)
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
      <p className="note">{noteOf(whole, named)}</p>
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

function noteOf(whole: boolean, named: string | undefined): string {
  if (whole) return 'Tout le territoire. « Réduire l’emprise » trace un rectangle sur la carte.'
  const kept = 'seuls les stations, pluviomètres et webcams du rectangle seront rejoués.'
  return named === undefined
    ? `Emprise réduite : ${kept} Zoomez ou déplacez la carte pour l’ajuster.`
    : `Emprise ${named} : ${kept} Zoomez ou déplacez la carte pour l’ajuster : elle deviendra une emprise réduite.`
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
      <select
        value={value}
        className={value === '' ? 'unset' : undefined}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
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
 * The basin unions, by the name a list shows, loaded apart: their outlines weigh
 * more than the rest of the form, and the map's chunk already carries them.
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
  onChange: Framed,
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
