/**
 * Three screens, one address each.
 *
 * No routing library: `/` is the list, `/nouveau` the creation and
 * `/rejeux/<id>` a replay, and a dependency that reads three paths would be
 * more to keep than to gain.
 *
 * The creation sits outside `/rejeux/`: `nouveau` is a well-formed replay
 * identifier, and under that prefix the two addresses would collide.
 */
export type Route = { screen: 'home' } | { screen: 'creation' } | { screen: 'replay'; id: string }

export const HOME_PATH = '/'
export const CREATION_PATH = '/nouveau'

export function routeOf(pathname: string): Route {
  if (/^\/nouveau\/?$/.test(pathname)) return { screen: 'creation' }
  const id = /^\/rejeux\/([^/]+)\/?$/.exec(pathname)?.[1]
  return id === undefined ? { screen: 'home' } : { screen: 'replay', id }
}

/** A replay's own address, so a reload and a shared link both land on it. */
export function replayPath(id: string): string {
  return `/rejeux/${id}`
}

export function goTo(path: string): void {
  history.pushState(null, '', path)
  // `pushState` fires no event of its own; the application listens for this
  // one, and the back button raises it too.
  dispatchEvent(new PopStateEvent('popstate'))
}

export function goToReplay(id: string): void {
  goTo(replayPath(id))
}

type Click = Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

/**
 * Whether a click on a link is the application's to follow.
 *
 * A modified or middle click is the browser's — a new tab, a new window — and
 * a link that swallowed it would open nothing where the agent asked for it.
 */
export function isPlainClick(click: Click): boolean {
  return click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey
}
