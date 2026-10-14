import type { Instant } from '@smmarchives/shared/clock.ts'
import type { ReplayEvent } from '@smmarchives/shared/contracts/event.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { useRef } from 'react'

import type { ReplayContent } from '../tracks/lanes.ts'
import { extentOf } from './placing.ts'
import { ReportForm } from './ReportForm.tsx'
import { ReportSheet } from './ReportSheet.tsx'
import type { PanelControl } from './usePanel.ts'
import { useClickOutside } from './useClickOutside.ts'

export type ReportPanelProps = {
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
 * The sheet of an event, or the form that reports one, on the left of the replay.
 *
 * A click anywhere else closes it — through the same request as its own close
 * button, so a form the agent typed into asks first.
 */
export function ReportPanel(props: ReportPanelProps) {
  const held = useRef<HTMLDivElement>(null)
  const { panel, close } = props.control
  useClickOutside(held, panel !== undefined, close)
  if (panel === undefined) return null

  return (
    // A box for the click to be judged against, which lays nothing out.
    <div className="panel" ref={held}>
      <PanelContent {...props} />
    </div>
  )
}

function PanelContent({ manifest, content, control, changes }: ReportPanelProps) {
  const { panel } = control
  if (panel === undefined) return null
  if (panel.kind === 'form') return <FormPanel {...{ manifest, control, changes }} at={panel.at} />

  // Looked up in the content rather than held, so the panel shows what the
  // replay holds under that name now.
  const event = content.events.find((one) => one.id === panel.id)
  if (event === undefined) return null
  if (panel.kind === 'edit') {
    return <FormPanel {...{ manifest, control, changes }} at={event.from} editing={event} />
  }

  return (
    <ReportSheet
      report={event}
      replayId={manifest.id}
      onClose={control.close}
      onEdit={() => {
        control.request({ kind: 'edit', id: event.id })
      }}
      onRemoved={(id) => {
        changes.removed(id)
        control.show(undefined)
      }}
    />
  )
}

function FormPanel({
  manifest,
  control,
  changes,
  at,
  editing,
}: Omit<ReportPanelProps, 'content'> & { at: Instant; editing?: ReplayEvent }) {
  return (
    <ReportForm
      // A different event is a different form: what was typed for one is not
      // carried over to the next.
      key={editing?.id ?? 'new'}
      replayId={manifest.id}
      period={manifest.period}
      extent={extentOf(manifest)}
      at={at}
      editing={editing}
      leaving={control.leaving}
      onLeave={control.leave}
      onStay={control.stay}
      onCancel={control.close}
      onTouched={control.setTouched}
      onReported={(saved) => {
        changes.saved(saved)
        control.show({ kind: 'sheet', id: saved.id })
      }}
    />
  )
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
