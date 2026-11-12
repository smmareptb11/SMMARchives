/** One of the choices a picker offers: what it says, and what it stands for. */
export type Pill<T> = {
  label: string
  value: T
  /** Why this choice alone is not offered, when it is not. */
  unavailable?: string | undefined
}
