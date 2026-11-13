import type { Instant } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { useAdmin } from '../admin.tsx'
import type { ReplayContent } from '../tracks/lanes.ts'
import type { HistoryEntry } from './history.ts'
import { History } from './History.tsx'
import { extentOf, type Placement } from './placing.ts'
import { ReportForm } from './ReportForm.tsx'
import { formKeyOf, type PanelControl } from './usePanel.ts'

type ReportPanelProps = {
  manifest: ReplayManifest
  content: ReplayContent
  control: PanelControl
  changes: ContentChanges
}

/** What the API has just stored or removed, for the screen to hold without reloading. */
export type ContentChanges = {
  saved: (event: ReplayEvent) => void
  removed: (id: string) => void
}

/**
 * The right-hand column: the form that reports or amends an event while one is
 * open, the history otherwise. The form hides nothing, so a click elsewhere
 * leaves it open; it closes on its own buttons, or when another event is to be
 * reported or amended, asking first if the agent typed anything.
 */
export function ReportColumn({
  manifest,
  content,
  control,
  changes,
  at,
  playing,
  onPlacement,
  onShow,
  onOpenReport,
}: ReportPanelProps & {
  /** Where the reading stands, which is where a new event starts. */
  at: Instant
  playing: boolean
  onPlacement: (placement: Placement | undefined) => void
  /** Sends the map to what a card of the history is about. */
  onShow: (entry: HistoryEntry) => void
  /** Opens a report's window, from its card, or once the form has saved it. */
  onOpenReport: (event: ReplayEvent) => void
}) {
  const { panel } = control
  const { signedIn } = useAdmin()
  const forms = { manifest, control, changes, onPlacement, onOpenReport }
  if (panel?.kind === 'form') {
    return <FormPanel {...forms} at={panel.at} />
  }
  // Looked up in the content rather than held, so the form amends what the
  // replay holds under that name now.
  const editing =
    panel?.kind === 'edit' ? content.events.find((one) => one.id === panel.id) : undefined
  if (editing === undefined) {
    return (
      <History
        action={
          signedIn === true ? <ReportButton manifest={manifest} at={at} control={control} /> : null
        }
        content={content}
        replayId={manifest.id}
        at={Date.parse(at)}
        playing={playing}
        onOpen={(entry) => {
          const report = content.events.find((one) => one.id === entry.id)
          if (entry.kind === 'report' && report !== undefined) onOpenReport(report)
          onShow(entry)
        }}
      />
    )
  }

  return <FormPanel {...forms} at={editing.from} editing={editing} />
}

function FormPanel({
  manifest,
  control,
  changes,
  at,
  editing,
  onPlacement,
  onOpenReport,
}: Omit<ReportPanelProps, 'content'> & {
  at: Instant
  editing?: ReplayEvent
  onPlacement: (placement: Placement | undefined) => void
  onOpenReport: (event: ReplayEvent) => void
}) {
  return (
    <ReportForm
      key={formKeyOf(at, editing)}
      replayId={manifest.id}
      period={manifest.period}
      extent={extentOf(manifest)}
      onPlacement={onPlacement}
      at={at}
      editing={editing}
      leaving={control.leaving}
      onLeave={control.leave}
      onStay={control.stay}
      onCancel={control.close}
      onTouched={control.setTouched}
      onReported={(saved) => {
        changes.saved(saved)
        control.show(undefined)
        onOpenReport(saved)
      }}
    />
  )
}

/**
 * Where reporting starts, in the heading of the column the form opens in: shown
 * to the administrator on every replay, and turned off with its reason where
 * the API would refuse.
 */
function ReportButton({
  manifest,
  at,
  control,
}: {
  manifest: ReplayManifest
  /** Where the reading stands, which is where the event will start. */
  at: Instant
  control: PanelControl
}) {
  const refusal = refusalOf(manifest)

  return (
    <p className="report-entry">
      <button
        type="button"
        disabled={refusal !== undefined}
        onClick={() => {
          control.request({ kind: 'form', at })
        }}
      >
        + Ajouter un événement
      </button>
      {refusal === undefined ? null : <span className="note">{refusal}</span>}
    </p>
  )
}

function refusalOf(manifest: ReplayManifest): string | undefined {
  if (manifest.state === 'running') return 'Le rejeu est en cours de construction.'
  if (manifest.datasets.events === undefined) {
    return 'Ce rejeu ne porte pas de liste d’événements : la voie qui la produit a échoué.'
  }
  return undefined
}
