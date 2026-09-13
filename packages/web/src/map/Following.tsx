import type { Map as MapLibreMap } from 'maplibre-gl'

import type { Views } from '../pictures.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import type { Shown } from './families.ts'
import { RadarLayer } from './RadarLayer.tsx'
import type { Bubble } from './useCallout.ts'
import { WebcamMarkers } from './WebcamMarkers.tsx'

/**
 * What follows the reading, hung on the map rather than drawn by it.
 *
 * The two together because they answer one question at every tick — what was
 * seen at this instant — and neither is a layer `showFamilies` can reach: a
 * camera is an HTML marker, and the rainfall needs an image near enough to the
 * reading before its own switch means anything.
 */
export function Following({
  map,
  content,
  replayId,
  at,
  bubble,
  shown,
  mutesShown,
  views,
  product,
}: {
  map: MapLibreMap | undefined
  content: ReplayContent
  replayId: string
  at: Cursor
  bubble: Bubble
  shown: Shown
  mutesShown: boolean
  views: Views
  product: string | undefined
}) {
  return (
    <>
      <WebcamMarkers
        map={map}
        content={content}
        replayId={replayId}
        at={at}
        bubble={bubble}
        shown={shown.webcam}
        mutesShown={mutesShown}
        views={views}
      />
      <RadarLayer
        map={map}
        content={content}
        replayId={replayId}
        at={at}
        product={product}
        shown={shown.radar}
      />
    </>
  )
}
