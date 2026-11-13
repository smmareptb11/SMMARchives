import type { Webcam } from '@smmarchives/shared/contracts/webcam.ts'

import type { Offset } from './floating.ts'
import type { DrawnSource } from './sources.ts'

/** What a window shows the measures or the views of: a source, or a camera. */
export type Measured = { kind: 'source'; source: DrawnSource } | { kind: 'camera'; camera: Webcam }

/** What an open window is about: what was measured, or what an agent reported. */
export type Subject = Measured | { kind: 'report'; id: string }

/**
 * A window open on the screen. `rank` stacks it, the highest in front; `step` is
 * its place in the cascade, which only says where it first stands.
 */
export type Window = { key: string; subject: Subject; rank: number; step: number }

/**
 * How far each window of the cascade opens from the one before, in pixels:
 * down by the height of its title bar, so the bar of the one before stays in
 * sight, and a little aside, so its edge does too.
 */
const CASCADE = { x: 24, y: 56 }

/** What names a window: one source of a family, one camera, or one report. */
export function keyOf(subject: Subject): string {
  if (subject.kind === 'camera') return `camera:${subject.camera.code}`
  if (subject.kind === 'report') return `report:${subject.id}`
  return `${subject.source.kind}:${String(subject.source.id)}`
}

/** The windows with this subject's in front: one already open is raised, not opened twice. */
export function opening(windows: readonly Window[], subject: Subject): readonly Window[] {
  const key = keyOf(subject)
  if (windows.some((one) => one.key === key)) return raising(windows, key)
  return [...windows, { key, subject, rank: nextRank(windows), step: freeStep(windows) }]
}

/** The windows with this one in front, the same list when it already is. */
export function raising(windows: readonly Window[], key: string): readonly Window[] {
  if (frontOf(windows) === key) return windows
  const rank = nextRank(windows)
  return windows.map((one) => (one.key === key ? { ...one, rank } : one))
}

export function closing(windows: readonly Window[], key: string): readonly Window[] {
  return windows.filter((one) => one.key !== key)
}

/** The window in front of the others, if any is open. */
export function frontOf(windows: readonly Window[]): string | undefined {
  let front: Window | undefined
  for (const one of windows) if (front === undefined || one.rank > front.rank) front = one
  return front?.key
}

/** Where a window of the cascade first stands, from the corner windows open in. */
export function cascadeOf(step: number): Offset {
  return { x: step * CASCADE.x, y: step * CASCADE.y }
}

function nextRank(windows: readonly Window[]): number {
  return Math.max(-1, ...windows.map((one) => one.rank)) + 1
}

/** The first place of the cascade no open window holds, so none opens over another. */
function freeStep(windows: readonly Window[]): number {
  const taken = new Set(windows.map((one) => one.step))
  let step = 0
  while (taken.has(step)) step += 1
  return step
}
