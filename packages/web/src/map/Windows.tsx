import { ReportSheet } from '../events/ReportSheet.tsx'
import type { Views } from '../pictures.ts'
import type { Cursor } from '../transport/reading.ts'
import type { ReplayContent } from '../tracks/lanes.ts'
import { CalloutView } from './CalloutView.tsx'
import { FloatingWindow } from './FloatingWindow.tsx'
import type { Detail } from './useWindows.ts'
import { frontOf, type Window } from './windows.ts'

/**
 * Every window open over the map, stacked as the reader last touched them. Apart
 * from the map, which arrives last, since a report's window opens from the lanes
 * and the history too.
 */
export function Windows({
  windows,
  detail,
  content,
  views,
  replayId,
  at,
  onSeek,
  onEdit,
  onRemoved,
}: {
  windows: readonly Window[]
  detail: Detail
  content: ReplayContent
  views: Views
  replayId: string
  at: Cursor
  onSeek: (at: Cursor) => void
  /** Amends a report, in the form of the right-hand column. */
  onEdit: (id: string) => void
  /** The API removed a report: the screen lets it go. */
  onRemoved: (id: string) => void
}) {
  if (windows.length === 0) return null
  const front = frontOf(windows)

  return (
    <div className="callouts">
      {windows.map((one) => {
        const { key, subject } = one
        const shared = { window: one, detail, front: key === front }
        if (subject.kind !== 'report') {
          return (
            <CalloutView
              {...shared}
              {...{ subject, content, views, replayId, at, onSeek }}
              key={key}
            />
          )
        }

        return (
          <ReportWindow
            {...shared}
            {...{ content, replayId, onEdit, onRemoved }}
            key={key}
            id={subject.id}
          />
        )
      })}
    </div>
  )
}

/** What an agent reported, in its window. */
function ReportWindow({
  id,
  window,
  detail,
  front,
  content,
  replayId,
  onEdit,
  onRemoved,
}: {
  id: string
  window: Window
  detail: Detail
  front: boolean
  content: ReplayContent
  replayId: string
  onEdit: (id: string) => void
  onRemoved: (id: string) => void
}) {
  // Looked up in the content rather than held, so the window shows what the
  // replay holds under that name now.
  const report = content.events.find((one) => one.id === id)
  if (report === undefined) return null

  return (
    <FloatingWindow
      {...{ window, detail, front }}
      title={report.title}
      subtitle="Événement signalé"
    >
      <ReportSheet
        report={report}
        replayId={replayId}
        onEdit={() => {
          onEdit(id)
        }}
        onRemoved={(removed) => {
          detail.close(window.key)
          onRemoved(removed)
        }}
      />
    </FloatingWindow>
  )
}
