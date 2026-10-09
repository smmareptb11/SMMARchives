import { Marker, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl'
import { useEffect } from 'react'

import type { Position } from '@smmarchives/shared/contracts/geometry.ts'

/**
 * A click on the map taken as a place, while — and only while — one is asked.
 *
 * Nothing else starts it: the agent asks, by the form's own button, and the
 * first click answers. A pan or a zoom in between is a pan or a zoom.
 */
export function usePicking(
  map: MapLibreMap | undefined,
  picking: boolean,
  onPicked: (position: Position) => void,
): void {
  useEffect(() => {
    if (map === undefined || !picking) return

    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    // A marker answers its own click and keeps it from the map: while a place
    // is picked, the click on it is the place, and opens nothing on the side.
    const container = map.getContainer()
    container.classList.add('picking')
    const onClick = (event: MapMouseEvent) => {
      onPicked({ lon: event.lngLat.lng, lat: event.lngLat.lat })
    }
    map.on('click', onClick)

    return () => {
      map.off('click', onClick)
      canvas.style.cursor = ''
      container.classList.remove('picking')
    }
  }, [map, picking, onPicked])
}

/**
 * Where the event being written will stand, before it exists.
 *
 * The same diamond as a placed event, hollow: the agent sees the place they
 * picked, and that nothing is stored yet.
 */
export function usePin(map: MapLibreMap | undefined, position: Position | null): void {
  useEffect(() => {
    if (map === undefined || position === null) return

    const element = diamond('written-event pending')
    const marker = new Marker({ element }).setLngLat([position.lon, position.lat]).addTo(map)

    return () => {
      marker.remove()
    }
  }, [map, position])
}

/**
 * A marker's element: a point of no size, with the diamond centred on it.
 *
 * MapLibre places a marker by its element's `transform`, so the element itself
 * must carry no other: a rotation on it turns the offset MapLibre wrote along
 * with it, and the further a place lies from the map's corner, the further its
 * marker lands from it. The diamond inside is what turns.
 */
export function diamond(className: string): HTMLElement {
  const element = document.createElement('div')
  element.className = className

  const shape = document.createElement('button')
  shape.type = 'button'
  shape.className = 'written-shape'
  element.append(shape)
  return element
}
