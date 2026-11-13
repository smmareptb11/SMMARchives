import { AppLink } from './AppLink.tsx'
import { HOME_PATH, replayPath, signInPath } from './routing.ts'
import type { Unreadable } from './unreadable.ts'

/**
 * Why a replay cannot be shown, in the middle of the screen, with the ways on
 * from there: the first one offered is the one most likely to show it.
 */
export function UnreadableNotice({ id, unreadable }: { id: string; unreadable: Unreadable }) {
  const { title, said, signIn, retry } = unreadable
  // One way on stands out: trying again when the server failed, the sign-in otherwise.
  const first = retry ? 'retry' : signIn ? 'signIn' : 'list'
  const look = (way: typeof first) => (way === first ? 'action' : 'action secondary')

  return (
    <section className="unreadable">
      <h1>{title}</h1>
      <p>{said}</p>
      <div className="actions">
        {retry ? (
          <button type="button" className={look('retry')} onClick={() => location.reload()}>
            Réessayer
          </button>
        ) : null}
        {signIn ? (
          <AppLink href={signInPath(replayPath(id))} className={look('signIn')}>
            Se connecter
          </AppLink>
        ) : null}
        <AppLink href={HOME_PATH} className={look('list')}>
          Voir la liste des rejeux
        </AppLink>
      </div>
      {/* What an administrator is asked for when a reader reports it. */}
      <p className="note">
        Rejeu demandé : <code>{id}</code>
      </p>
    </section>
  )
}
