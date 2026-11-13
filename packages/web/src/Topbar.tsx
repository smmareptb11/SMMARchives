import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { ReplayManifest } from '@smmarchives/shared/contracts/replay.ts'

import { useAdmin } from './admin.tsx'
import { api } from './api.ts'
import { AppLink } from './AppLink.tsx'
import { entryOf } from './home/entries.ts'
import { PublicationControl } from './PublicationControl.tsx'
import { goTo, HOME_PATH, SIGN_IN_PATH, signInPath } from './routing.ts'
import { formatPeriod } from './time.ts'

/**
 * The band over every screen, naming the replay open once there is one, and
 * offering the administrator to publish it.
 */
export function Topbar({
  replay,
  onPublication,
}: {
  replay?: ReplayManifest | undefined
  onPublication?: (manifest: ReplayManifest) => void
}) {
  const { signedIn } = useAdmin()

  return (
    <header className={replay === undefined ? 'topbar' : 'topbar replaying'}>
      <AppLink href={HOME_PATH} className="brand">
        SMMARchives
      </AppLink>
      {replay === undefined ? null : (
        <>
          <AppLink href={HOME_PATH} className="home" label="Retour aux rejeux">
            ‹
          </AppLink>
          <p>
            <strong>{entryOf(replay).title}</strong>
            <span>{formatPeriod(replay.period)}</span>
          </p>
        </>
      )}
      <div className="slot" ref={useContext(SlotContext).setSlot} />
      {signedIn === true && replay !== undefined && onPublication !== undefined ? (
        <PublicationControl manifest={replay} onChanged={onPublication} />
      ) : null}
      <Session />
    </header>
  )
}

type Slot = { slot: HTMLElement | null; setSlot: (slot: HTMLElement | null) => void }

const SlotContext = createContext<Slot>({ slot: null, setSlot: () => {} })

/**
 * Where a screen puts commands of its own in the band, which owns none of the
 * screen's state: the screen draws into it through a portal.
 */
export function TopbarSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const value = useMemo(() => ({ slot, setSlot }), [slot])
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>
}

/** Draws its children in the band, once the band is there to hold them. */
export function InTopbar({ children }: { children: ReactNode }) {
  const { slot } = useContext(SlotContext)
  return slot === null ? null : createPortal(children, slot)
}

/**
 * Signing in from wherever the reader is, back to it afterwards; signing out
 * to the list, since the replay open may be one only the administrator sees.
 */
function Session() {
  const { signedIn, expired, settle } = useAdmin()
  const [failed, setFailed] = useState(false)

  if (signedIn === undefined || location.pathname === SIGN_IN_PATH) return null
  if (!signedIn) {
    const link = (
      <AppLink href={signInPath(location.pathname)} className="session">
        Se connecter
      </AppLink>
    )
    // Said here, the one place every screen shares: the control whose write
    // was refused may have gone with the session.
    if (!expired) return link
    return (
      <span className="session">
        <span>Session expirée.</span>
        {link}
      </span>
    )
  }
  return (
    <span className="session">
      {failed ? <span>L’API n’a pas fermé la session.</span> : null}
      <button
        type="button"
        onClick={() => {
          api.signOut().then(
            () => {
              settle(false)
              goTo(HOME_PATH)
            },
            () => setFailed(true),
          )
        }}
      >
        Se déconnecter
      </button>
    </span>
  )
}
