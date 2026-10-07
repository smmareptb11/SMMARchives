import 'maplibre-gl/dist/maplibre-gl.css'

import type { BoundingBox } from '@smmarchives/shared/contracts/geometry.ts'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { BLANK, groundOf } from '../map/ground.ts'
import { FRAME } from './extent.ts'
import { basinMap, listen, pickerOn, settle, type Picker } from './viewfinder.ts'

export type ExtentPickerProps = {
  onChange: (extent: BoundingBox | null) => void
}

/**
 * A viewfinder over the map: what the rectangle frames is the extent.
 *
 * The rectangle holds still in the middle of the view, so zooming or moving the
 * map is how the extent is set. Drawn by the page over the map, it stays still
 * while the ground moves under it.
 */
export function ExtentPicker({ onChange }: ExtentPickerProps) {
  const [whole, setWhole] = useState(true)
  const { container, groundless, ready, picker } = useMountedPicker(onChange)

  function narrow(narrowed: boolean): void {
    if (picker.current === undefined) return
    picker.current.narrowed = narrowed
    setWhole(!narrowed)
    settle(picker.current)
  }

  return (
    <fieldset className="extent">
      <legend>Emprise</legend>
      {groundless ? (
        <p className="note refusal">
          Fond de carte injoignable. La carte reste utilisable, le fond reste blanc.
        </p>
      ) : null}
      <div className="extent-view">
        <div className="extent-map" ref={container} />
        {whole ? null : (
          <div
            className="extent-frame"
            style={{
              left: `${FRAME.left * 100}%`,
              top: `${FRAME.top * 100}%`,
              right: `${(1 - FRAME.right) * 100}%`,
              bottom: `${(1 - FRAME.bottom) * 100}%`,
            }}
          />
        )}
      </div>
      <p className="note">
        {whole
          ? 'Tout le territoire. « Réduire l’emprise » trace un rectangle sur la carte.'
          : 'Emprise réduite : seuls les stations, pluviomètres et webcams du rectangle seront rejoués. Zoomez ou déplacez la carte pour l’ajuster.'}
      </p>
      <button type="button" disabled={!ready} onClick={() => narrow(whole)}>
        {whole ? 'Réduire l’emprise' : 'Tout le territoire'}
      </button>
    </fieldset>
  )
}

/** Builds the map once, and tears it down once. */
function useMountedPicker(onChange: (extent: BoundingBox | null) => void): {
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
        picker.current = pickerOn(created, change)
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
