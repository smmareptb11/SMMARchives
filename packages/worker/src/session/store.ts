/**
 * The administrator's sessions, each known by the digest of its token.
 *
 * Expiry is judged on the database's clock rather than on the caller's, so one
 * instant decides it wherever the API runs.
 */
export type SessionStore = {
  /** Records a session until `expiresAt`, and forgets those already expired. */
  open(digest: string, expiresAt: string): Promise<void>
  /** Whether the session exists and has not expired. */
  isOpen(digest: string): Promise<boolean>
  close(digest: string): Promise<void>
}
