import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { keepBoundsOnResize, type Resizable } from '../src/map/keepBounds.ts'

/**
 * MapLibre stood in for by what the function reads of it: its bounds, its
 * container's size, and the two events it listens to. Fitting moves the view,
 * as the real map does, so a fit is followed by a `moveend`.
 */
function aMap(size = { width: 800, height: 600 }) {
  const listeners = new Map<string, (() => void)[]>()
  const emit = (event: string) => {
    for (const listener of listeners.get(event) ?? []) listener()
  }
  let bounds = 'the opening'
  const fitted: string[] = []

  const map: Resizable<string> = {
    getBounds: () => bounds,
    getContainer: () => ({ clientWidth: size.width, clientHeight: size.height }),
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    fitBounds: (asked) => {
      fitted.push(asked)
      bounds = `${asked}, fitted to a new size`
      emit('moveend')
    },
  }
  keepBoundsOnResize(map)

  return {
    fitted,
    resized: () => emit('resize'),
    /** The reader pans or zooms. */
    moved: (to: string) => {
      bounds = to
      emit('moveend')
    },
  }
}

let phone = false

beforeEach(() => {
  vi.useFakeTimers()
  phone = false
  vi.stubGlobal('matchMedia', () => ({ matches: phone }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a map whose container is resized', () => {
  it('shows the places it showed before, rather than its centre and its zoom', () => {
    const map = aMap()

    map.resized()

    expect(map.fitted).toEqual(['the opening'])
  })

  /** A drag of the lanes' handle is a hundred resizes: each fit widens the view a little. */
  it('holds the bounds from before the first resize through a run of them', () => {
    const map = aMap()

    map.resized()
    map.resized()
    map.resized()

    expect(map.fitted).toEqual(['the opening', 'the opening', 'the opening'])
  })

  it('takes the reader’s own view once the run of resizes is over', () => {
    const map = aMap()
    map.resized()
    vi.advanceTimersByTime(1_000)

    map.moved('Carcassonne, closer')
    map.resized()

    expect(map.fitted.at(-1)).toBe('Carcassonne, closer')
  })

  it('leaves a phone’s map to MapLibre, which shows it and hides it rather than resizing it', () => {
    phone = true
    const map = aMap()

    map.resized()

    expect(map.fitted).toEqual([])
  })

  it('leaves alone a map that has no size, which has nothing to fit', () => {
    const map = aMap({ width: 800, height: 0 })

    map.resized()

    expect(map.fitted).toEqual([])
  })
})
