import { createContext, type PointerEvent } from 'react'

import type { Station } from '@smmarchives/shared/contracts/station.ts'

import type { HistoryEntry } from '../events/history.ts'
import { kindOf, type Kind } from './sources.ts'

/**
 * What the pointer rests on, away from the map, that the map has a place for:
 * a source it draws, a report it places, or a camera.
 */
export type Pointed = { source: Kind; id: number } | { report: string } | { camera: string }

/**
 * Where the lanes and the history say what the pointer rests on, and where the
 * map hears it. Outside React's state, or a pointer sweeping down the lanes would
 * render the whole screen once per lane crossed.
 */
type Pointer = {
  get: () => Pointed | undefined
  set: (pointed: Pointed | undefined) => void
  subscribe: (listener: (pointed: Pointed | undefined) => void) => () => void
}

export function pointerOf(): Pointer {
  let held: Pointed | undefined
  const listeners = new Set<(pointed: Pointed | undefined) => void>()

  return {
    get: () => held,
    set: (pointed) => {
      if (samePointed(held, pointed)) return
      held = pointed
      for (const listener of listeners) listener(pointed)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** One per replay screen; outside one, a pointer nobody listens to. */
export const PointerContext = createContext<Pointer>(pointerOf())

/**
 * What an element says to the map while the pointer rests on it, and stops
 * saying when it leaves. A mouse's or a pen's: a finger rests on nothing, and
 * a tap would leave a light on the map nobody asked for.
 */
export function pointingAt(pointer: Pointer, pointed: Pointed | undefined) {
  if (pointed === undefined) return {}
  return {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== 'touch') pointer.set(pointed)
    },
    onPointerLeave: () => {
      pointer.set(undefined)
    },
  }
}

function samePointed(one: Pointed | undefined, other: Pointed | undefined): boolean {
  return JSON.stringify(one) === JSON.stringify(other)
}

/**
 * What a card of the history stands for on the map: a crossing its station,
 * a report itself. A crossing of a station the replay does not hold has none.
 */
export function pointedOf(entry: HistoryEntry, stations: readonly Station[]): Pointed | undefined {
  if (entry.kind === 'report') return { report: entry.id }

  const station = stations.find((one) => one.id === entry.sourceId)
  return station === undefined ? undefined : { source: kindOf(station.category), id: station.id }
}
