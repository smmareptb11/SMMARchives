import { useEffect, useState } from 'react'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { AdminProvider, useAdmin } from './admin.tsx'
import { api, sessionLost } from './api.ts'
import { AppLink } from './AppLink.tsx'
import { BuildScreen } from './build/BuildScreen.tsx'
import { EMPTY, followBuild, readThenFollow, type BuildState } from './build/progress.ts'
import { CreationForm } from './creation/CreationForm.tsx'
import { HomeScreen } from './home/HomeScreen.tsx'
import {
  CREATION_PATH,
  goTo,
  goToReplay,
  replayPath,
  routeOf,
  signInPath,
  type Route,
} from './routing.ts'
import { withPublication } from './publication.ts'
import { ReplayScreen } from './ReplayScreen.tsx'
import { SignInScreen } from './SignInScreen.tsx'
import { Topbar, TopbarSlotProvider } from './Topbar.tsx'
import { confirmsSession, unreadableReplay } from './unreadable.ts'

export function App() {
  return (
    <AdminProvider>
      <TopbarSlotProvider>
        <Screen route={useRoute()} />
      </TopbarSlotProvider>
    </AdminProvider>
  )
}

function Screen({ route }: { route: Route }) {
  // Keyed by the replay, so opening another starts afresh rather than from
  // what the last one read, or failed to.
  if (route.screen === 'replay') return <Replay key={route.id} id={route.id} />

  return (
    <>
      <Topbar />
      <main>
        {route.screen === 'home' ? <HomeScreen /> : null}
        {route.screen === 'signIn' ? <SignInScreen /> : null}
        {route.screen === 'creation' ? <Creation /> : null}
      </main>
    </>
  )
}

/**
 * The creation, for the administrator; the sign-in first for anyone else, and
 * back here once it is done.
 */
function Creation() {
  const { signedIn } = useAdmin()

  useEffect(() => {
    if (signedIn === false) goTo(signInPath(CREATION_PATH), { replace: true })
  }, [signedIn])

  if (signedIn !== true) return null
  return <CreationForm onCreated={(manifest) => goToReplay(manifest.id)} />
}

/** The address, and what the back button does to it. */
function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeOf(location.pathname))

  useEffect(() => {
    const read = () => setRoute(routeOf(location.pathname))
    addEventListener('popstate', read)
    return () => removeEventListener('popstate', read)
  }, [])

  return route
}

/**
 * One replay: its construction while it runs, what it holds once it is over.
 *
 * The manifest is read first, and the stream opened only on a build that is
 * still running: a replay constituted last week has nothing to follow, and
 * opening a stream on it would wait for news that will never come.
 */
function Replay({ id }: { id: string }) {
  const [manifest, setManifest] = useState<ReplayManifest | undefined>(undefined)
  const [build, setBuild] = useState<BuildState>(EMPTY)
  const [failure, setFailure] = useState<{ error: unknown } | undefined>(undefined)
  // Held apart from the manifest: replacing it would hand the screen new data
  // set references and reload every one of them, and a build's stream, holding
  // its own copy, could answer with the publication as it was.
  const [publication, setPublication] = useState<{ at: string | undefined } | undefined>(undefined)

  useEffect(
    () =>
      readThenFollow(
        () => api.manifestOf(id),
        () => followBuild(id, setBuild),
        { read: setManifest, failed: (error) => setFailure({ error }) },
      ),
    [id],
  )

  const read = build.manifest ?? manifest

  return (
    <>
      <Topbar
        replay={
          read === undefined || publication === undefined
            ? read
            : withPublication(read, publication.at)
        }
        onPublication={(changed) => setPublication({ at: changed.publishedAt })}
      />
      <main>
        {failure === undefined ? (
          <Replaying manifest={manifest} build={build} />
        ) : (
          <Unreadable id={id} error={failure.error} />
        )}
      </main>
    </>
  )
}

/** Why it could not be read, and the sign-in when that is what might show it. */
function Unreadable({ id, error }: { id: string; error: unknown }) {
  const { signedIn, settle } = useAdmin()
  const [confirmed, setConfirmed] = useState(false)
  const confirming = confirmsSession(error, signedIn) && !confirmed

  useEffect(() => {
    if (!confirming) return
    // An API that does not answer leaves the session as it was believed. One
    // found closed is lost as a refused write loses it, which the band says.
    api
      .session()
      .then(
        (session) => {
          if (session.authenticated) settle(true)
          else sessionLost.dispatchEvent(new Event('lost'))
        },
        () => {},
      )
      .finally(() => setConfirmed(true))
  }, [confirming, settle])

  const unreadable = unreadableReplay(error, confirming ? undefined : signedIn)
  if (unreadable === undefined) return null
  const { said, signIn } = unreadable

  return (
    <p className="refusal">
      {said}
      {signIn ? (
        <>
          {' '}
          <AppLink href={signInPath(replayPath(id))}>Se connecter</AppLink>
        </>
      ) : null}
    </p>
  )
}

/** What there is to show of it: the wait, the trace or the replay. */
function Replaying({
  manifest,
  build,
}: {
  manifest: ReplayManifest | undefined
  build: BuildState
}) {
  if (manifest === undefined) return <p>Lecture du rejeu…</p>

  // What the stream published if it published anything, the manifest read at
  // the start otherwise: a replay already finished never opens a stream.
  const current = build.manifest ?? manifest

  // A replay that is still being built, or whose build stored nothing at all,
  // has no lanes to show: what there is to see is the trace.
  if (current.state === 'running' || current.state === 'failed') {
    return <BuildScreen manifest={current} journal={build.journal} />
  }
  return <ReplayScreen manifest={current} />
}
