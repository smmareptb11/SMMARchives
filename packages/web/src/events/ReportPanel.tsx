import type { Instant } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import type { ReplayContent } from '../tracks/lanes.ts'
import { extentOf } from './placing.ts'
import { ReportForm } from './ReportForm.tsx'
import { ReportSheet } from './ReportSheet.tsx'
import type { PanelControl } from './usePanel.ts'

export type ReportPanelProps = {
  manifest: ReplayManifest
  content: ReplayContent
  control: PanelControl
  /** An event the API has just stored, for the screen to hold without reloading. */
  onSaved: (event: ReplayEvent) => void
}

/** The sheet of an event, or the form that reports one, on the left of the replay. */
export function ReportPanel({ manifest, content, control, onSaved }: ReportPanelProps) {
  const { panel } = control
  if (panel === undefined) return null

  if (panel.kind === 'form') {
    return (
      <ReportForm
        replayId={manifest.id}
        period={manifest.period}
        extent={extentOf(manifest)}
        at={panel.at}
        leaving={control.leaving}
        onLeave={control.leave}
        onStay={control.stay}
        onCancel={control.close}
        onTouched={control.setTouched}
        onReported={(event) => {
          onSaved(event)
          control.show({ kind: 'sheet', id: event.id })
        }}
      />
    )
  }

  // Looked up in the content rather than held, so the sheet shows what the
  // replay holds under that name now.
  const report = content.events.find((one) => one.id === panel.id)
  if (report === undefined) return null
  return <ReportSheet report={report} replayId={manifest.id} onClose={control.close} />
}

/**
 * Where reporting starts, under the replay's title.
 *
 * Shown on every replay, and turned off with its reason where the API would
 * refuse: a button that does nothing tells less than one that says why.
 */
export function ReportButton({
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
        Saisir un événement
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
