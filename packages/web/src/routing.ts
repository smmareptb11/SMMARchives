/**
 * Two screens, one address each.
 *
 * No routing library: `/` is the creation and `/rejeux/<id>` is a replay, and
 * a dependency that reads two paths would be more to keep than to gain.
 */
export type Route = { screen: 'creation' } | { screen: 'replay'; id: string }

export function routeOf(pathname: string): Route {
  const id = /^\/rejeux\/([^/]+)\/?$/.exec(pathname)?.[1]
  return id === undefined ? { screen: 'creation' } : { screen: 'replay', id }
}

/** A replay's own address, so a reload and a shared link both land on it. */
export function goToReplay(id: string): void {
  history.pushState(null, '', `/rejeux/${id}`)
  // `pushState` fires no event of its own; the application listens for this
  // one, and the back button raises it too.
  dispatchEvent(new PopStateEvent('popstate'))
}

export function goToCreation(): void {
  history.pushState(null, '', '/')
  dispatchEvent(new PopStateEvent('popstate'))
}
