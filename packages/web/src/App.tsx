import { useEffect, useState } from 'react'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { api } from './api.ts'
import { BuildScreen } from './build/BuildScreen.tsx'
import { EMPTY, followBuild, type BuildState } from './build/progress.ts'
import { CreationForm } from './creation/CreationForm.tsx'
import { describe } from './problems.ts'
import { goToReplay, routeOf, type Route } from './routing.ts'
import { ReplayScreen } from './ReplayScreen.tsx'

export function App() {
  const route = useRoute()

  return (
    <main>
      {route.screen === 'creation' ? (
        <CreationForm onCreated={(manifest) => goToReplay(manifest.id)} />
      ) : (
        <Replay id={route.id} />
      )}
    </main>
  )
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
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let stop: (() => void) | undefined
    api.manifestOf(id).then(
      (read) => {
        setManifest(read)
        if (read.state === 'running') stop = followBuild(id, setBuild)
      },
      (error: unknown) => setFailure(describe(error)),
    )
    return () => stop?.()
  }, [id])

  if (failure !== undefined) return <p className="refusal">{failure}</p>
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
