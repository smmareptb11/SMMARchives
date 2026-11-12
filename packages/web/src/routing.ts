/**
 * Four screens, one address each.
 *
 * No routing library: `/` is the list, `/nouveau` the creation, `/connexion`
 * the sign-in and `/rejeux/<id>` a replay, and a dependency that reads four
 * paths would be more to keep than to gain.
 *
 * The creation sits outside `/rejeux/`: `nouveau` is a well-formed replay
 * identifier, and under that prefix the two addresses would collide.
 */
export type Route =
  | { screen: 'home' }
  | { screen: 'creation' }
  | { screen: 'signIn' }
  | { screen: 'replay'; id: string }

export const HOME_PATH = '/'
export const CREATION_PATH = '/nouveau'
export const SIGN_IN_PATH = '/connexion'

export function routeOf(pathname: string): Route {
  if (/^\/nouveau\/?$/.test(pathname)) return { screen: 'creation' }
  if (/^\/connexion\/?$/.test(pathname)) return { screen: 'signIn' }
  const id = /^\/rejeux\/([^/]+)\/?$/.exec(pathname)?.[1]
  return id === undefined ? { screen: 'home' } : { screen: 'replay', id }
}

/** A replay's own address, so a reload and a shared link both land on it. */
export function replayPath(id: string): string {
  return `/rejeux/${id}`
}

/** The sign-in, and where it leads once the password is accepted. */
export function signInPath(next: string): string {
  return `${SIGN_IN_PATH}?${new URLSearchParams({ suite: next }).toString()}`
}

/**
 * Where the sign-in leads, read from its address.
 *
 * Only a path of this application: the address can be handed to anyone, and a
 * sign-in that went on to another site would lend it this one's name. `//host`
 * and `/\host` are other sites to a browser, for all they start with a slash.
 */
export function nextAfterSignIn(search: string): string {
  const next = new URLSearchParams(search).get('suite')
  return next !== null && /^\/(?![/\\])/.test(next) ? next : HOME_PATH
}

/**
 * `replace` takes the place of the current address in the history, for a step
 * the back button should not return to.
 */
export function goTo(path: string, { replace = false } = {}): void {
  if (replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  // Neither fires an event of its own; the application listens for this
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
