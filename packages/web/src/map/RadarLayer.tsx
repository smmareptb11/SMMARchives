import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useRef } from 'react'

import { api } from '../api.ts'
import { sheetAt, sheetsOf, toleranceOf } from '../radar.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { redraws, showRadar, type Placed } from './layers.ts'

/**
 * The rainfall image the reading stands on, laid on the map that draws it.
 *
 * Hung on the map rather than drawn by it, like the cameras and for the same
 * reason: what it shows follows the cursor, where `map/layers.ts` draws what a
 * replay holds still. It answers its own visibility because two things decide
 * it — the switch, and whether the delivery left an image near enough — and
 * `showFamilies` only knows the first.
 */
export function RadarLayer({
  map,
  content,
  replayId,
  at,
  product,
  shown,
}: {
  map: MapLibreMap | undefined
  content: ReplayContent
  replayId: string
  at: Cursor
  /** The cumul the reader chose, of the nine a delivery can carry. */
  product: string | undefined
  shown: boolean
}) {
  // One memo for both: the tolerance is measured on the images themselves, so it
  // can never go stale on its own, and a second boundary would be a second
  // dependency list to keep right for nothing.
  const { sheets, tolerance } = useMemo(() => {
    const held = product === undefined ? [] : sheetsOf(content.series, product)

    return { sheets: held, tolerance: toleranceOf(held) }
  }, [content.series, product])

  // What the map already carries. `redraws` says when that stops being what the
  // reading asks for, and why the map's identity counts as much as the address.
  const drawn = useRef<Placed | undefined>(undefined)

  useEffect(() => {
    if (map === undefined) return

    const sheet = shown ? sheetAt(sheets, at, tolerance) : undefined
    const next = { map, url: sheet === undefined ? undefined : api.mediaUrl(replayId, sheet.path) }
    if (!redraws(drawn.current, next)) return

    // After the call and not before: `showRadar` answers nothing on a map that
    // carries no such layer, and noting the address first would pin the ref to
    // something never drawn, which nothing would then retry.
    showRadar(map, next.url)
    drawn.current = next
  }, [map, sheets, tolerance, at, shown, replayId])

  return null
}
