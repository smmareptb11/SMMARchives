import { useEffect, useState } from 'react'

import { api } from '../api.ts'
import { describe } from '../problems.ts'
import { CREATION_PATH, goTo, isPlainClick } from '../routing.ts'
import { entriesOf, type ReplayEntry } from './entries.ts'

/** Every replay constituted so far, and the way to constitute another. */
export function HomeScreen() {
  const [entries, setEntries] = useState<ReplayEntry[] | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    api.listReplays().then(
      (manifests) => setEntries(entriesOf(manifests)),
      (error: unknown) => setFailure(describe(error)),
    )
  }, [])

  return (
    <section>
      <h1>Rejeux</h1>
      <p>
        <AppLink href={CREATION_PATH} className="action">
          Constituer un rejeu
        </AppLink>
      </p>
      <Listing entries={entries} failure={failure} />
    </section>
  )
}

function Listing({
  entries,
  failure,
}: {
  entries: ReplayEntry[] | undefined
  failure: string | undefined
}) {
  if (failure !== undefined) return <p className="refusal">{failure}</p>
  if (entries === undefined) return <p>Lecture des rejeux…</p>
  if (entries.length === 0) return <p className="note">Aucun rejeu constitué.</p>

  return (
    <ul className="replays">
      {entries.map((entry) => (
        <li key={entry.id} data-state={entry.state}>
          <AppLink href={entry.href}>{entry.title}</AppLink>
          <span className="state">{entry.stateLabel}</span>
          <small>{entry.period}</small>
          <small>Constitué le {entry.createdAt}</small>
        </li>
      ))}
    </ul>
  )
}

/** A real link, so it opens in a new tab too, followed in place otherwise. */
function AppLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (!isPlainClick(event)) return
        event.preventDefault()
        goTo(href)
      }}
    >
      {children}
    </a>
  )
}
