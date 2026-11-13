import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { api, sessionLost } from './api.ts'

type Admin = {
  /** Undefined until the API has said, which a screen waits for rather than guess. */
  signedIn: boolean | undefined
  /** The API refused a request for want of the session this browser held. */
  expired: boolean
  /** What a sign-in or a sign-out has just settled, without asking the API again. */
  settle: (signedIn: boolean) => void
}

const AdminContext = createContext<Admin>({
  signedIn: undefined,
  expired: false,
  settle: () => {},
})

/**
 * Whether this browser holds the administrator's session, asked once. Only what
 * the interface shows rests on it: the API refuses a stranger's change whatever
 * this says.
 */
export function AdminProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Pick<Admin, 'signedIn' | 'expired'>>({
    signedIn: undefined,
    expired: false,
  })
  const settle = useCallback((signedIn: boolean) => {
    setState({ signedIn, expired: false })
  }, [])

  useEffect(() => {
    // An API that does not answer opens nothing, and a stranger is what it
    // would take the browser for.
    api.session().then(
      (session) => settle(session.authenticated),
      () => settle(false),
    )
  }, [settle])

  useEffect(() => {
    // Expired only if there was a session to lose: a stranger's wrong password
    // is refused the same way.
    const lost = () =>
      setState((was) => ({ signedIn: false, expired: was.expired || was.signedIn === true }))
    sessionLost.addEventListener('lost', lost)
    return () => sessionLost.removeEventListener('lost', lost)
  }, [])

  const admin = useMemo(() => ({ ...state, settle }), [state, settle])
  return <AdminContext value={admin}>{children}</AdminContext>
}

export function useAdmin(): Admin {
  return useContext(AdminContext)
}
