import type { Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { RainTotal } from '../detail/RainTotal.tsx'
import { StationMeasures } from '../detail/StationMeasures.tsx'
import type { Views } from '../pictures.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { calloutOfCamera, calloutOfSource } from './callouts.ts'
import type { DrawnSource } from './sources.ts'

/** What an open bubble is about. */
export type Subject = { kind: 'source'; source: DrawnSource } | { kind: 'camera'; camera: Webcam }

/**
 * What the bubble shows, at the instant being read.
 *
 * Rendered on every tick, and that is the point: what a source says changes
 * with the reading, and React replaces only the words that changed.
 */
export function CalloutView({
  subject,
  content,
  views,
  replayId,
  at,
}: {
  subject: Subject
  content: ReplayContent
  views: Views
  replayId: string
  at: Cursor
}) {
  const said =
    subject.kind === 'source'
      ? calloutOfSource(content.events, subject.source, at)
      : calloutOfCamera(subject.camera, views, at)

  return (
    <>
      <strong>{said.title}</strong>
      {said.lines.map((one, index) => (
        <p key={index}>{one}</p>
      ))}
      {subject.kind === 'source' ? (
        <SourceMeasures subject={subject.source} content={content} replayId={replayId} at={at} />
      ) : null}
    </>
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
  if (subject.kind === 'rain-gauge') {
    // The replay knowing no rain at all is not this gauge having measured none,
    // and accusing each of two hundred and twenty-nine gauges in turn would be
    // a lie. `ReplayContent` is where the two were told apart, once.
    if (content.rain === undefined) return <p className="note">Ce rejeu ne porte aucune mesure.</p>

    return <RainTotal gauges={content.rain} sourceId={subject.id} period={content.period} at={at} />
  }

  return (
    <StationMeasures
      replayId={replayId}
      sourceId={subject.id}
      thresholds={content.thresholds}
      at={at}
    />
  )
}
