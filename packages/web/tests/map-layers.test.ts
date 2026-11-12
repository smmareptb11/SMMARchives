import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import { filterOf, paintSources } from '../src/map/layers.ts'
import { KINDS, type Kind } from '../src/map/sources.ts'

/** Whether a layer would draw a feature carrying these properties. */
function draws(kind: Kind, mutesShown: boolean, properties: Record<string, unknown>): boolean {
  // The key names where the expression would sit in a style; nothing reads it
  // back, and the validator refuses to run without one.
  const filter = featureFilter(filterOf(kind, mutesShown), 'layers[0].filter')

  return filter.filter({ zoom: 10 }, { type: 1, properties })
}

describe('what a family layer draws', () => {
  it('draws the sources of its own family and no other', () => {
    expect(draws('rain-gauge', false, { kind: 'rain-gauge', mute: false })).toBe(true)
    expect(draws('rain-gauge', false, { kind: 'watercourse', mute: false })).toBe(false)
  })

  it('leaves out the sources the replay holds nothing of, until they are asked for', () => {
    expect(draws('rain-gauge', false, { kind: 'rain-gauge', mute: true })).toBe(false)
    expect(draws('rain-gauge', true, { kind: 'rain-gauge', mute: true })).toBe(true)
  })

  /**
   * A replay drawn from a build older than the property carries no `mute` at
   * all. Negated rather than compared with `true`, the filter would read that
   * absence as « mute » and empty the map of a parc nothing is known against.
   */
  it('draws a source carrying no answer either way', () => {
    expect(draws('watercourse', false, { kind: 'watercourse' })).toBe(true)
  })
})

describe('the outline of a selected source', () => {
  /** Every paint asked of a map that holds every layer, by layer. */
  function painted(colours: Map<string, string>): Map<string, unknown> {
    const paints = new Map<string, unknown>()
    paintSources(
      {
        getLayer: () => ({}),
        setPaintProperty: (layer, _property, value) => paints.set(layer, value),
      },
      colours,
    )
    return paints
  }

  /** An orange of its own would read as one more threshold reached. */
  it('is painted in the colour of the source it outlines, at every tick', () => {
    const paints = painted(new Map([['watercourse:84', '#ff9900']]))

    for (const kind of KINDS) {
      expect(paints.get(`sources-${kind}-selected`), kind).toEqual(paints.get(`sources-${kind}`))
    }
    expect(JSON.stringify(paints.get('sources-watercourse-selected'))).toContain('#ff9900')
  })
})
