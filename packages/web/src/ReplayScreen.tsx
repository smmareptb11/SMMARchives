import { Suspense, lazy, useCallback, useMemo, useState, type ComponentProps } from 'react'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { cursorAt, instantAt } from './transport/reading.ts'
import { paintedAt } from './map/state.ts'
import { PointerContext, pointerOf } from './map/pointed.ts'
import { viewsOf } from './pictures.ts'
import { useWindows } from './map/useWindows.ts'
import { Windows } from './map/Windows.tsx'
import { frontOf } from './map/windows.ts'
import { ReportColumn, type ContentChanges } from './events/ReportPanel.tsx'
import { usePanel, type PanelControl } from './events/usePanel.ts'
import { useReportWindows } from './events/useReportWindows.ts'
import { dotsOf } from './transport/dots.ts'
import { useCursor, type Reading } from './transport/useCursor.ts'
import { heldIn, lanesOf, type ReplayContent } from './tracks/lanes.ts'
import { useBetweenColumnAndMap } from './useBetweenColumnAndMap.ts'
import { ViewSwitch } from './ViewSwitch.tsx'
import { Montage } from './Montage.tsx'
import { useContent } from './useReplayContent.ts'

/**
 * Loaded on the screen that draws one, and on no other.
 *
 * MapLibre and its stylesheet weigh a megabyte of script and eighty kilobytes
 * of style. Imported here, they land in the first chunk, and the creation form
 * — which shows no map — waits for them before it can draw a text field.
 */
const MapView = lazy(async () => ({ default: (await import('./map/MapView.tsx')).MapView }))

/**
 * One replay: the map of what it holds, and the lanes of when it happened.
 *
 * The loading lives here rather than in either view, because both read the same
 * data sets — the crossings that will colour a station are the crossings that
 * draw its segment. Loading them twice would be reading the same thing twice.
 */
export function ReplayScreen({ manifest }: { manifest: ReplayManifest }) {
  const { content, failure, changes } = useContent(manifest)
  // One per screen, held still: the lanes, the history and the map share it.
  const [pointer] = useState(pointerOf)

  if (failure !== undefined) return <p className="refusal">{failure}</p>
  if (content === undefined) return <p>Lecture du rejeu…</p>

  return (
    <PointerContext value={pointer}>
      <Replayed manifest={manifest} content={content} changes={changes} />
    </PointerContext>
  )
}

/**
 * The reading, shared by the map and the lanes.
 *
 * Its own component because the cursor rests on a replay that has arrived: a
 * hook above the loading would have to invent a period for a replay nobody has
 * read yet.
 *
 * Colouring at an instant asks nothing new of the API: a crossing carries its
 * start, its end and its colour, so the same events the lanes draw are what the
 * map paints with.
 */
function Replayed({
  manifest,
  content,
  changes,
}: {
  manifest: ReplayManifest
  content: ReplayContent
  changes: ContentChanges
}) {
  const { reading, seek, dots } = useReading(manifest, content)
  const colours = useMemo(() => paintedAt(content, reading.at), [content, reading.at])
  // Above the map and the lanes because it reaches both: a replay keeps the
  // sources that answered nothing, and the reader says when to see them.
  const [mutesShown, setMutesShown] = useState(false)
  // Built here rather than inside the lanes, because the switch's own count is
  // read off them: built twice, the number on the switch and the lanes under it
  // could disagree. On the replay alone, so a click on the switch filters what
  // is built rather than building it again.
  const families = useMemo(() => lanesOf(content), [content])
  const heldBack = useMemo(() => heldIn(families), [families])
  const panel = usePanel()
  const between = useBetweenColumnAndMap(content, reading)
  const { placement, setPlacement, asked, onShow, shown } = between
  const placing = placement?.listening !== undefined
  const { detail, windows } = useWindows(manifest.id, placing)
  const { openReport, openEvent } = useReportWindows(content, reading, {
    detail,
    panel: panel.panel,
    placing,
  })

  return (
    <div className="replay" data-view={shown.view}>
      <ViewSwitch {...shown} front={frontOf(windows)} onClose={detail.close} />
      <MapSection
        {...{ manifest, content, changes, reading, colours, heldBack, placement, asked }}
        {...{ detail, windows, mutesShown, panel }}
        onMutesShown={setMutesShown}
        onOpenReport={openReport}
      />
      <ReportColumn
        {...{ manifest, content, changes, onShow, playing: reading.playing }}
        control={panel}
        at={instantAt(reading.at)}
        onPlacement={setPlacement}
        onOpenReport={openEvent}
      />

      <Montage
        manifest={manifest}
        reading={reading}
        {...{ families, dots, mutesShown, onSeek: seek, front: frontOf(windows) }}
        onOpenReport={openReport}
        onOpenLane={between.onOpenLane}
      />
    </div>
  )
}

/**
 * The map, and the windows over it.
 *
 * The windows apart from the map, which arrives last: a report's window opens
 * from the lanes and the history as well.
 */
function MapSection({
  manifest,
  content,
  changes,
  reading,
  panel,
  ...map
}: Omit<ComponentProps<typeof MapView>, 'replayId' | 'label' | 'at' | 'views'> & {
  manifest: ReplayManifest
  changes: ContentChanges
  reading: Reading
  panel: PanelControl
}) {
  const views = useMemo(() => viewsOf(content.images), [content.images])

  return (
    <section className="replay-map">
      {/* Nothing while it arrives: the lanes are readable without it. */}
      <Suspense fallback={null}>
        <MapView
          {...map}
          {...{ content, views }}
          replayId={manifest.id}
          label={manifest.label}
          at={reading.at}
        />
      </Suspense>
      <Windows
        {...{ content, views, windows: map.windows, detail: map.detail }}
        replayId={manifest.id}
        at={reading.at}
        onSeek={reading.seek}
        onEdit={(id) => {
          panel.request({ kind: 'edit', id })
        }}
        onRemoved={(id) => {
          changes.removed(id)
          // The form amending it has nothing left to amend, nor to ask about.
          if (panel.panel?.kind === 'edit' && panel.panel.id === id) panel.show(undefined)
        }}
      />
    </section>
  )
}

/**
 * The cursor over the replay, seeking it from a fraction of the period, and the
 * events it jumps to — which are the dots the ruler draws, so that a jump lands
 * on a dot and nowhere else.
 */
function useReading(manifest: ReplayManifest, content: ReplayContent) {
  const dots = useMemo(
    () => dotsOf(content.events, manifest.period),
    [content.events, manifest.period],
  )
  const marks = useMemo(() => dots.map((one) => one.at), [dots])
  const reading = useCursor(manifest.period, marks)
  const seek = useCallback(
    (fraction: number) => {
      reading.seek(cursorAt(manifest.period, fraction))
    },
    // `reading.seek` is memoised by `useCursor`; `reading` itself is a new object on every
    // render, so watching it would rebuild this callback sixty times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stable member, not the object
    [reading.seek, manifest.period],
  )
  return { reading, seek, dots }
}
