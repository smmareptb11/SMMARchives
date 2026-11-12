import { memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import type { TimeWindow } from '@smmarchives/shared/clock.ts'
import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { LaneFailure } from '../build/LaneFailure.tsx'
import type { Named } from '../map/frame.ts'
import { Lane } from './Lane.tsx'
import { isShape, swatchOf } from '../map/symbols.ts'
import type { Dot } from '../transport/dots.ts'
import { useDrag } from '../transport/useDrag.ts'
import { assumedIn, countOf, HATCHED, QUIET } from './heading.ts'
import { isQuiet, speaking, type Family } from './lanes.ts'
import { ticksOf } from './ruler.ts'
import { Ticks } from './Ticks.tsx'

export type TrackListProps = {
  manifest: ReplayManifest
  /** What the replay holds, already laid out: `ReplayScreen` builds them once. */
  families: readonly Family[]
  /** Every event, at the instant the arrows jump to. */
  dots: readonly Dot[]
  /** Where the reader pointed, as a fraction of the period. */
  onSeek: (fraction: number) => void
  /** Holds the reading while the ruler is dragged; stable, as `useCursor` keeps it. */
  onHold: () => () => void
  /** Whether the lanes with nothing on them are asked for. */
  mutesShown: boolean
  /** Opens what an agent reported. Stable, or every lane re-renders with the cursor. */
  onOpenReport: (id: string) => void
  /** Opens a source's or a camera's detail, from its lane's name. Stable, for the same reason. */
  onOpenLane: (named: Named) => void
}

/**
 * What a replay brought back, one lane per source.
 *
 * It knows nothing of the cursor, and takes no prop that moves with it: three
 * hundred lanes rebuilt sixty times a second would make the reading stutter,
 * and not one of them changes as the cursor advances. The reading bar is drawn
 * beside it, by something that does move.
 */
export const TrackList = memo(function TrackList({
  manifest,
  families,
  dots,
  onSeek,
  onHold,
  mutesShown,
  onOpenReport,
  onOpenLane,
}: TrackListProps) {
  return (
    <section>
      <HourGrid period={manifest.period} />
      <Ruler period={manifest.period} dots={dots} onSeek={onSeek} onHold={onHold} />

      {families.map((family) => (
        <FamilyLanes
          key={family.id}
          family={family}
          replayId={manifest.id}
          mutesShown={mutesShown}
          onOpenReport={onOpenReport}
          onSeek={onSeek}
          onOpenLane={onOpenLane}
        />
      ))}

      <LanesThatFailed manifest={manifest} />
    </section>
  )
})

/** One family, folded until the reader opens it, with the lanes they asked for counted in its heading. */
function FamilyLanes({
  family,
  replayId,
  mutesShown,
  onOpenReport,
  onSeek,
  onOpenLane,
}: {
  family: Family
  replayId: string
  mutesShown: boolean
  onOpenReport: (id: string) => void
  onSeek: (fraction: number) => void
  onOpenLane: (named: Named) => void
}) {
  const [quietShown, setQuietShown] = useState(true)
  const asked = mutesShown ? family.lanes : speaking(family)
  const lanes = quietShown ? asked : asked.filter((one) => !isQuiet(one))
  const quiet = family.lanes.filter(isQuiet).length
  const glyph = useGlyph(family.id)

  return (
    <details>
      <summary>
        {family.label}{' '}
        <Count family={family} shown={lanes.length} quiet={asked.length - lanes.length} />
      </summary>
      <QuietSwitch count={quiet} shown={quietShown} onChange={setQuietShown} />
      {family.silent === undefined ? null : <p className="note">{silenceOf(family.silent)}</p>}
      {assumedIn(family) === 0 ? null : (
        <p className="note assumed-note">
          <span className="swatch" aria-hidden="true" />
          {HATCHED}
        </p>
      )}
      {lanes.map((lane) => (
        <Lane
          key={lane.id}
          lane={lane}
          glyph={glyph}
          replayId={replayId}
          onOpenReport={onOpenReport}
          onSeek={onSeek}
          onOpenLane={onOpenLane}
        />
      ))}
    </details>
  )
}

/**
 * The mark of a family before each of its lanes, as the mockup draws it.
 *
 * The shape is the map's own, used as a mask so the montage gives it its
 * colour: drawn again in the stylesheet, the two drawings would drift. Drawn
 * once per family, not once per lane. A camera is a frame rather than a shape,
 * and the radar rainfall, which the map does not draw, has none.
 */
function useGlyph(family: string): ReactNode {
  return useMemo(() => {
    if (isShape(family)) {
      const mask = `url(${swatchOf(family, '#000')})`
      return <i className="glyph" style={{ maskImage: mask }} aria-hidden="true" />
    }
    return family === 'webcam' ? <i className="glyph webcam" aria-hidden="true" /> : null
  }, [family])
}

const plural = (count: number) => (count > 1 ? 's' : '')

/**
 * What a family holds when it holds no lane at all.
 *
 * One family can reach this: the rain gauges of a replay that collected no
 * measure. Every other source of this screen gets a lane whether it has
 * anything on it or not, and the switch is what decides whether it is drawn.
 */
function silenceOf(count: number): string {
  return `${String(count)} pluviomètre${plural(count)} dans ce rejeu, sans piste : il ne porte aucune mesure de pluie.`
}

/** The switch on a family's lanes that crossed nothing, there only when it has some. */
function QuietSwitch({
  count,
  shown,
  onChange,
}: {
  count: number
  shown: boolean
  onChange: (shown: boolean) => void
}) {
  if (count === 0) return null

  return (
    <label className="note quiet-switch">
      <input
        type="checkbox"
        checked={shown}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      {QUIET} ({count})
    </label>
  )
}

/** A family's count, and what it leaves unsaid on hovering it. */
function Count({ family, shown, quiet }: { family: Family; shown: number; quiet: number }) {
  const { said, more } = countOf(family, shown, quiet)
  return (
    <span className="count" title={more}>
      {said}
    </span>
  )
}

/**
 * A faint line on every tick of the ruler, down through every lane.
 *
 * Laid once under the lanes rather than drawn in each: three hundred lanes
 * would repeat the same lines, and they are the ruler's, not the lanes'.
 */
function HourGrid({ period }: { period: TimeWindow }) {
  return (
    <div className="hour-grid" aria-hidden="true">
      {ticksOf(period).map((tick) => (
        <i key={tick.at} style={{ '--at': tick.fraction } as CSSProperties} />
      ))}
    </div>
  )
}

/**
 * The hours of the period, in French time, and where one seeks.
 *
 * The ruler is what a reader points at to move in time, so it is what listens:
 * a bar thin enough to be a bar is too thin to aim at, and the lanes below say
 * what happened rather than when one is looking.
 */
function Ruler({
  period,
  dots,
  onSeek,
  onHold,
}: {
  period: TimeWindow
  dots: readonly Dot[]
  onSeek: (fraction: number) => void
  onHold: () => () => void
}) {
  const drag = useDrag(onSeek, onHold)

  return (
    <div className="lane ruler">
      <div className="lane-label">Sources</div>
      {/*
        No `slider` role and no tab stop. The role promises a value and keyboard
        handling this element cannot give: it is memoised away from the cursor
        on purpose, so it does not know where the reading is. And a tab stop
        here would silence the arrows, which `Transport` binds on the document
        and only for what has no focus of its own.
      */}
      <div className="lane-track" {...drag}>
        <Ticks period={period} dots={dots} />
      </div>
    </div>
  )
}

/** A lane that did not run is said, rather than left as an absence. */
function LanesThatFailed({ manifest }: { manifest: ReplayManifest }) {
  const failed = Object.entries(manifest.lanes).filter(([, lane]) => lane.state !== 'done')
  if (failed.length === 0) return null

  return (
    <div className="refusal">
      Ce rejeu est incomplet.
      <ul>
        {failed.map(([name, lane]) => (
          <li key={name}>
            <LaneFailure lane={name} state={lane.state} error={lane.error} />
          </li>
        ))}
      </ul>
    </div>
  )
}
