import { memo, useMemo, useState, type ComponentProps } from 'react'

import type { ReplayContent } from '../tracks/lanes.ts'

import { PHONE } from '../phone.ts'
import { LayerPanel } from './LayerPanel.tsx'
import { silencesOf } from './silences.ts'

/**
 * The panel over the map, folded down to its title on the reader's word alone
 * — and on a phone from the start, where unfolded it would hide a third of the
 * map. Read once, as the replay opens: turning the phone folds nothing.
 *
 * Folded, it hides nothing of what it switches: the families stay as they were
 * set, and only the room the panel takes on the map is given back.
 */
export function Legend({ children }: { children: React.ReactNode }) {
  const [folded, setFolded] = useState(() => matchMedia(PHONE).matches)

  return (
    <aside className={folded ? 'map-legend folded' : 'map-legend'}>
      <button
        type="button"
        className="fold"
        aria-expanded={!folded}
        onClick={() => {
          setFolded(!folded)
        }}
      >
        {folded ? 'Développer' : 'Réduire'}
      </button>
      {children}
    </aside>
  )
}

/** The panel over the map: the families it switches, and what it leaves undrawn. */
export function MapLegend(props: ComponentProps<typeof LayerPanel>) {
  return (
    <Legend>
      <LayerPanel {...props} />
      <Silences content={props.content} />
    </Legend>
  )
}

/** What the map holds back, as `map/silences.ts` decides to put it, under the legend. */
const Silences = memo(function Silences({ content }: { content: ReplayContent }) {
  // Memoised because the map beside it re-renders on every tick, and one of
  // these sentences counts a collection of three hundred features.
  const said = useMemo(() => silencesOf(content), [content])

  return (
    <ul className="silences">
      {said.map((one) => (
        <li key={one}>{one}</li>
      ))}
    </ul>
  )
})
