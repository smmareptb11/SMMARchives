import type { JournalEntry, ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { formatInstant } from '../time.ts'

const LANE_LABEL: Record<string, string> = {
  aquasys: 'Aquasys',
  lizmap: 'Lizmap',
  'radar-rainfall': "Lames d'eau",
  events: 'Franchissements',
  media: 'Médias',
}

const LANE_STATE: Record<string, string> = {
  pending: 'en attente',
  running: 'en cours',
  done: 'terminée',
  failed: 'en échec',
}

export type BuildScreenProps = {
  manifest: ReplayManifest
  journal: readonly JournalEntry[]
}

/** What a construction is doing, while it does it. */
export function BuildScreen({ manifest, journal }: BuildScreenProps) {
  const media = manifest.media

  return (
    <section>
      <h1>{manifest.label ?? 'Rejeu sans titre'}</h1>
      <p className="lead">
        Du {formatInstant(manifest.period.from)} au {formatInstant(manifest.period.to)}.
      </p>

      <ul className="lanes">
        {Object.entries(manifest.lanes).map(([name, lane]) => (
          <li key={name} data-state={lane.state}>
            <strong>{LANE_LABEL[name] ?? name}</strong> {LANE_STATE[lane.state] ?? lane.state}
            {lane.error === undefined ? null : <em> — {lane.error}</em>}
          </li>
        ))}
      </ul>

      <p className="note">
        Médias : {media.copied} copiés, {media.skipped} déjà là, {media.failed} en échec.
      </p>

      <ol className="journal">
        {journal.map((one) => (
          <li key={`${one.at}-${one.lane}-${one.kind}`}>
            <time>{formatInstant(one.at)}</time> {LANE_LABEL[one.lane] ?? one.lane} :{' '}
            {one.message ?? one.kind}
          </li>
        ))}
      </ol>
    </section>
  )
}
