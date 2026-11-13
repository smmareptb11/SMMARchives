import { PHONE } from '../phone.ts'

/** What keeping a map's places reads of it: its view, its size, two of its events. */
export type Resizable<Bounds> = {
  getBounds(): Bounds
  getContainer(): { clientWidth: number; clientHeight: number }
  on(event: 'moveend' | 'resize', listener: () => void): unknown
  fitBounds(bounds: Bounds, options: { animate: boolean }): unknown
}

/** How long resizes in a row are read as one, the bounds held through them. */
const SETTLE_MS = 300

/**
 * Keeps the places the map shows as its container is resized — by the lanes'
 * handle, by the window — where MapLibre keeps its centre and zoom: a shorter
 * map shows the same places, smaller, rather than fewer of them.
 *
 * The bounds held are the ones from before the first resize of a run, so that
 * the hundred steps of a drag do not each widen the view a little. Not on a
 * phone, where the map is shown and hidden rather than resized.
 */
export function keepBoundsOnResize<Bounds>(map: Resizable<Bounds>): void {
  let before = map.getBounds()
  let held: Bounds | undefined
  let settling: ReturnType<typeof setTimeout> | undefined

  map.on('moveend', () => {
    if (held === undefined) before = map.getBounds()
  })
  map.on('resize', () => {
    const { clientWidth, clientHeight } = map.getContainer()
    if (matchMedia(PHONE).matches || clientWidth === 0 || clientHeight === 0) return
    held ??= before
    map.fitBounds(held, { animate: false })
    clearTimeout(settling)
    settling = setTimeout(() => {
      held = undefined
      before = map.getBounds()
    }, SETTLE_MS)
  })
}
