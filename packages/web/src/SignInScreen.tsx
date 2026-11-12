import { useState } from 'react'

import { useAdmin } from './admin.tsx'
import { api } from './api.ts'
import { ApiError, describe } from './problems.ts'
import { goTo, nextAfterSignIn } from './routing.ts'

/** The one password, and the screen the administrator was on their way to. */
export function SignInScreen() {
  const { settle } = useAdmin()
  const [password, setPassword] = useState('')
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setRefusal(undefined)
    setSending(true)
    try {
      await api.signIn(password)
      settle(true)
      // In place of the sign-in, which the back button has no reason to reopen.
      goTo(nextAfterSignIn(location.search), { replace: true })
    } catch (error) {
      // A 401 here has one cause, a wrong password, so it is said in the
      // interface's language rather than in the API's.
      const refused = error instanceof ApiError && error.problem.status === 401
      setRefusal(refused ? 'Mot de passe refusé.' : describe(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h1>Connexion</h1>
      <p className="lead">
        Les rejeux non publiés et leur modification sont réservés à l’administrateur.
      </p>

      <label>
        Mot de passe
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {refusal === undefined ? null : (
        <p className="refusal" role="alert">
          {refusal}
        </p>
      )}

      <button type="submit" disabled={sending}>
        {sending ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  )
}
