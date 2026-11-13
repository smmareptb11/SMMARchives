import { memo, useMemo, useState, type ComponentProps } from 'react'

import type { ReplayContent } from '../tracks/lanes.ts'

import { PHONE } from '../phone.ts'
import { LayerPanel } from './LayerPanel.tsx'
import { silencesOf } from './silences.ts'

/**
 * The panel over the map, folded down to its title on the reader's word, and on a
 * phone from the start: read once, so turning the phone folds nothing. Folded, it
 * gives its room back and leaves the families as they were set.
 */
function Legend({ children }: { children: React.ReactNode }) {
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
  // The map beside it re-renders on every tick, and one sentence counts a whole collection.
  const said = useMemo(() => silencesOf(content), [content])

  return (
    <ul className="silences">
      {said.map((one) => (
        <li key={one}>{one}</li>
      ))}
    </ul>
  )
})
