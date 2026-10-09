import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { api } from '../api.ts'
import { instantAt } from '../transport/reading.ts'
import type { Reading } from '../transport/useCursor.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { EventSheet } from './EventSheet.tsx'
import type { Writing } from './useWriting.ts'
import { WrittenEventForm } from './WrittenEventForm.tsx'

/** The form an agent writes in, or the sheet of an event, floating on the map. */
export type WritingPanelProps = {
  writing: Writing
  manifest: ReplayManifest
  content: ReplayContent
  reading: Reading
  onEvents: (events: ReplayEvent[]) => void
}

export function WritingPanel({ writing, manifest, content, reading, onEvents }: WritingPanelProps) {
  const added = async (event: ReplayEvent, notice?: string) => {
    // Read again rather than spliced in: the list is the API's, in its order,
    // and its version has moved. Spliced in only if it cannot be read, so the
    // event the agent just wrote is not missing from what they look at.
    onEvents(
      await api
        .datasetOf<ReplayEvent[]>(manifest.id, 'events')
        .catch(() => [...content.events, event]),
    )
    reading.seek(Date.parse(event.from))
    writing.added(event.id, notice)
  }

  if (writing.writing) {
    return (
      <>
        {writing.picking ? <PickingHint /> : null}
        <WrittenEventForm
          replayId={manifest.id}
          scope={manifest}
          startsAt={instantAt(reading.at)}
          position={writing.position}
          picking={writing.picking}
          onPick={writing.pick}
          onUnplace={writing.unplace}
          onCancel={writing.cancel}
          onAdded={(event, notice) => void added(event, notice)}
        />
      </>
    )
  }

  const opened = content.events.find((one) => one.id === writing.opened)
  if (opened === undefined) return null

  return (
    <EventSheet
      event={opened}
      replayId={manifest.id}
      notice={writing.notice}
      onClose={writing.close}
    />
  )
}

/** Where the agent is looking while they pick, rather than in the form. */
function PickingHint() {
  return (
    <p className="picking-hint">
      Cliquez sur la carte pour placer l'événement · Échap pour renoncer
    </p>
  )
}
