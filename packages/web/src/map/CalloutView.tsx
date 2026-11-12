import { useMemo } from 'react'

import { RainTotal } from '../detail/RainTotal.tsx'
import { StationMeasures } from '../detail/StationMeasures.tsx'
import type { Views } from '../pictures.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { calloutOfCamera, calloutOfSource } from './callouts.ts'
import { CameraView } from './CameraView.tsx'
import { FloatingWindow } from './FloatingWindow.tsx'
import type { DrawnSource } from './sources.ts'
import type { Detail } from './useWindows.ts'
import type { Measured, Window } from './windows.ts'

/**
 * The detail of an open source, at the instant being read, in its window.
 *
 * Rendered on every tick, and that is the point: what a source says changes
 * with the reading, and React replaces only the words that changed.
 */
export function CalloutView({
  window,
  subject,
  front,
  detail,
  content,
  views,
  replayId,
  at,
  onSeek,
}: {
  window: Window
  subject: Measured
  front: boolean
  detail: Detail
  content: ReplayContent
  views: Views
  replayId: string
  at: Cursor
  onSeek: (at: Cursor) => void
}) {
  const said =
    subject.kind === 'source'
      ? calloutOfSource(subject.source)
      : calloutOfCamera(subject.camera, views, at)
  // The first line names the family, which the title bar carries under the name.
  const [family, ...lines] = said.lines

  return (
    <FloatingWindow {...{ window, front, detail }} title={said.title} subtitle={family}>
      {lines.map((one, index) => (
        <p key={index}>{one}</p>
      ))}
      {subject.kind === 'source' ? (
        <SourceMeasures subject={subject.source} content={content} replayId={replayId} at={at} />
      ) : (
        <CameraView
          {...{ views, replayId, at, onSeek }}
          camera={subject.camera}
          period={content.period}
        />
      )}
    </FloatingWindow>
  )
}

/**
 * What a source measured, which the two families answer differently.
 *
 * A rain gauge is watched against no threshold and gives what fell over a step;
 * a station is watched against a ladder and gives a level at an instant.
 */
function SourceMeasures({
  subject,
  content,
  replayId,
  at,
}: {
  subject: DrawnSource
  content: ReplayContent
  replayId: string
  at: Cursor
}) {
  // Looked up once per window, where the window renders on every tick.
  const station = useMemo(
    () => content.stations.find((one) => one.id === subject.id),
    [content.stations, subject.id],
  )

  if (subject.kind === 'rain-gauge') {
    // The replay knowing no rain at all is not this gauge having measured none,
    // and accusing each of two hundred and twenty-nine gauges in turn would be
    // a lie. `ReplayContent` is where the two were told apart, once.
    if (content.rain === undefined) return <p className="note">Ce rejeu ne porte aucune mesure.</p>

    return (
      <RainTotal
        gauges={content.rain}
        sourceId={subject.id}
        name={subject.name}
        period={content.period}
        at={at}
      />
    )
  }

  return (
    <StationMeasures
      replayId={replayId}
      sourceId={subject.id}
      name={subject.name}
      thresholds={content.thresholds}
      ngfDatum={station?.ngfDatum ?? null}
      levelDatum={station?.levelDatum ?? 'gauge'}
      period={content.period}
      at={at}
    />
  )
}
