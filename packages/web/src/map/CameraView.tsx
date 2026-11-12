import type { TimeWindow } from '@smmarchives/shared/clock.ts'
import type { Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import { api } from '../api.ts'
import { takenWhen, viewAt, viewStepsOf, type Views } from '../pictures.ts'
import type { Cursor } from '../transport/reading.ts'

/**
 * What a camera showed at the instant read, and the way to its other views.
 *
 * The full image when the replay froze it, the reduction otherwise — the one
 * the lane's preview shows. Its box keeps its shape while the image loads, so
 * the steps under it do not jump at each view. A step moves the reading onto
 * the view's own instant, and so the map, the lanes and this panel with it.
 */
export function CameraView({
  camera,
  period,
  views,
  replayId,
  at,
  onSeek,
}: {
  camera: Webcam
  period: TimeWindow
  views: Views
  replayId: string
  at: Cursor
  onSeek: (at: Cursor) => void
}) {
  const view = viewAt(views, camera.code, at)
  const steps = viewStepsOf(views, camera.code, at, period)
  const { previous, next } = steps

  return (
    <>
      {view === undefined ? (
        <p className="taken">Aucune image avant cet instant.</p>
      ) : (
        <>
          <img
            className="view"
            src={api.mediaUrl(replayId, view.full ?? view.path)}
            alt={`Webcam de ${camera.commune}`}
          />
          <p className="taken">{takenWhen(view, at)}</p>
        </>
      )}
      <p className="steps">
        <Step to={previous} name="Vue précédente" onSeek={onSeek}>
          ◀
        </Step>
        <span>
          {steps.index === undefined
            ? `${String(steps.count)} vue${steps.count > 1 ? 's' : ''}`
            : `Image ${String(steps.index + 1)}/${String(steps.count)}`}
        </span>
        <Step to={next} name="Vue suivante" onSeek={onSeek}>
          ▶
        </Step>
      </p>
    </>
  )
}

/** A step to another view, turned off where there is none. */
function Step({
  to,
  name,
  onSeek,
  children,
}: {
  to: Cursor | undefined
  name: string
  onSeek: (at: Cursor) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={name}
      disabled={to === undefined}
      onClick={() => {
        if (to !== undefined) onSeek(to)
      }}
    >
      {children}
    </button>
  )
}
