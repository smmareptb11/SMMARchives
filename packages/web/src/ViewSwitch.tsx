import { InTopbar } from './Topbar.tsx'

/** Which of the map and the history takes a phone's screen. */
export type View = 'map' | 'feed'

const VIEWS: [View, string][] = [
  ['map', 'Carte'],
  ['feed', 'Chronologie'],
]

/**
 * The map or the history, in the band, on a screen too narrow for both — or,
 * while a detail covers them, the way back to them, as the mockup's band offers.
 */
export function ViewSwitch({
  view,
  onView,
  front,
  onClose,
}: {
  view: View
  onView: (view: View) => void
  /** The window in front, which a phone shows alone. */
  front: string | undefined
  onClose: (key: string) => void
}) {
  if (front !== undefined) {
    return (
      <InTopbar>
        <button
          type="button"
          className="band-close"
          onClick={() => {
            onClose(front)
          }}
        >
          Fermer
        </button>
      </InTopbar>
    )
  }

  return (
    <InTopbar>
      <div className="view-switch" role="group" aria-label="Vue principale">
        {VIEWS.map(([one, label]) => (
          <button
            key={one}
            type="button"
            aria-pressed={one === view}
            onClick={() => {
              onView(one)
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </InTopbar>
  )
}
