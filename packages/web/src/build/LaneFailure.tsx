import { missingSaid } from './lanes.ts'

/**
 * What a replay lacks because a strand did not run, and why, folded away:
 * the reason is a host's own message, in English, for whoever has to repair.
 */
export function LaneFailure({
  lane,
  state,
  error,
}: {
  lane: string
  state: string
  error: string | undefined
}) {
  return (
    <span className="lane-failure">
      {missingSaid(lane, state)}
      {error === undefined ? null : (
        <details>
          <summary>Détail technique</summary>
          <code>{error}</code>
        </details>
      )}
    </span>
  )
}
