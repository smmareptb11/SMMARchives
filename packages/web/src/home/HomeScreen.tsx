import { useEffect, useState } from 'react'

import { useAdmin } from '../admin.tsx'
import { api } from '../api.ts'
import { describe } from '../problems.ts'
import { AppLink } from '../AppLink.tsx'
import { CREATION_PATH } from '../routing.ts'
import { galleryOf, withoutReplay, type Gallery, type ReplayEntry } from './entries.ts'
import { RemovalDialog } from './RemovalDialog.tsx'

/**
 * Every replay this browser may see: the published ones, and for the
 * administrator, apart, those still in preparation and the way to constitute
 * another.
 */
export function HomeScreen() {
  const [gallery, setGallery] = useState<Gallery | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [asked, setAsked] = useState<ReplayEntry | undefined>(undefined)
  const { signedIn } = useAdmin()

  // Read again on a sign-out, which lands here and takes away what only the
  // administrator was listed. An answer to the session before is let go: it
  // could arrive last, and list a stranger what only the administrator sees.
  useEffect(() => {
    if (signedIn === undefined) return
    let current = true
    api.listReplays().then(
      (manifests) => {
        if (!current) return
        setGallery(galleryOf(manifests))
        setFailure(undefined)
      },
      (error: unknown) => {
        if (current) setFailure(describe(error))
      },
    )
    return () => {
      current = false
    }
  }, [signedIn])

  return (
    <section>
      <header className="home-heading">
        <h1>Rejeux</h1>
        {signedIn === true ? (
          <AppLink href={CREATION_PATH} className="action">
            Constituer un rejeu
          </AppLink>
        ) : null}
      </header>
      <Sections gallery={gallery} failure={failure} admin={signedIn === true} onAsk={setAsked} />
      {asked === undefined ? null : (
        <RemovalDialog
          entry={asked}
          onClose={() => setAsked(undefined)}
          onRemoved={(id) => setGallery((before) => before && withoutReplay(before, id))}
        />
      )}
    </section>
  )
}

function Sections({
  gallery,
  failure,
  admin,
  onAsk,
}: {
  gallery: Gallery | undefined
  failure: string | undefined
  admin: boolean
  onAsk: (entry: ReplayEntry) => void
}) {
  if (failure !== undefined) return <p className="refusal">{failure}</p>
  if (gallery === undefined) return <p>Lecture des rejeux…</p>
  // A stranger is listed nothing else, and a heading over the one list would
  // name a distinction they cannot see.
  if (!admin) return <Listing entries={gallery.published} empty="Aucun rejeu public." />

  return (
    <>
      <h2>Publics</h2>
      <Listing entries={gallery.published} empty="Aucun rejeu public." onAsk={onAsk} />
      <h2>En préparation</h2>
      <Listing
        entries={gallery.preparing}
        empty="Aucun rejeu en préparation."
        preparing
        onAsk={onAsk}
      />
    </>
  )
}

function Listing({
  entries,
  empty,
  preparing = false,
  onAsk,
}: {
  entries: ReplayEntry[]
  empty: string
  preparing?: boolean
  /** Given to the administrator alone, who may remove a replay from here. */
  onAsk?: (entry: ReplayEntry) => void
}) {
  if (entries.length === 0) return <p className="note">{empty}</p>

  return (
    <ul className={preparing ? 'replays preparing' : 'replays'}>
      {entries.map((entry) => (
        <ReplayItem key={entry.id} entry={entry} onAsk={onAsk} />
      ))}
    </ul>
  )
}

function ReplayItem({
  entry,
  onAsk,
}: {
  entry: ReplayEntry
  onAsk: ((entry: ReplayEntry) => void) | undefined
}) {
  return (
    <li data-state={entry.state}>
      <p className="title">
        <AppLink href={entry.href}>{entry.title}</AppLink>
      </p>
      <p className="period">{entry.period}</p>
      <p className="scope">
        {entry.duration} · {entry.extent}
      </p>
      <About entry={entry} />
      {entry.figures.length === 0 ? null : (
        <ul className="figures">
          {entry.figures.map((figure) => (
            <li key={figure}>{figure}</li>
          ))}
        </ul>
      )}
      <footer>
        <small>Constitué le {entry.createdAt}</small>
        <span className="ends">
          {/* Nearly every replay is complete: only what is not says its state. */}
          {entry.state === 'complete' ? null : <span className="state">{entry.stateLabel}</span>}
          {onAsk === undefined ? null : (
            <button
              type="button"
              className="trash"
              title="Supprimer ce rejeu"
              aria-label={`Supprimer le rejeu ${entry.title}`}
              onClick={() => onAsk(entry)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d={TRASH} fillRule="evenodd" />
              </svg>
            </button>
          )}
        </span>
      </footer>
    </li>
  )
}

/** The phenomenon, the severity and the description, each when one was given. */
function About({ entry }: { entry: ReplayEntry }) {
  return (
    <>
      <Tags phenomenon={entry.phenomenon} severity={entry.severity} />
      {/* Cut to three lines on the card, and whole on hover. */}
      {entry.description === undefined ? null : (
        <p className="description" title={entry.description}>
          {entry.description}
        </p>
      )}
    </>
  )
}

function Tags({ phenomenon, severity }: Pick<ReplayEntry, 'phenomenon' | 'severity'>) {
  if (phenomenon === undefined && severity === undefined) return null

  return (
    <p className="about">
      {phenomenon === undefined ? null : <span className="phenomenon">{phenomenon}</span>}
      {severity === undefined ? null : (
        <span className="severity" data-severity={severity.level}>
          {severity.label}
        </span>
      )}
    </p>
  )
}

/** A bin and its lid, on the 16 × 16 grid the transport's glyphs are drawn on. */
const TRASH = 'M6 1h4v1h4v2H2V2h4zM3 5h10l-1 10H4zM6 7v6h1V7zM9 7v6h1V7z'
