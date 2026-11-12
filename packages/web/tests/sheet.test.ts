import { describe, expect, it } from 'vitest'

import {
  centredScroll,
  followed,
  following,
  inView,
  pageTurn,
  settled,
} from '../src/transport/sheet.ts'

describe('the lanes under a phone transport, once let go', () => {
  it('close when dragged down more than a quarter of their height', () => {
    expect(settled(true, 101, 400)).toBe(false)
    expect(settled(true, 99, 400)).toBe(true)
  })

  it('open when dragged up more than a fifth of their height', () => {
    expect(settled(false, -81, 400)).toBe(true)
    expect(settled(false, -79, 400)).toBe(false)
  })

  it('stay as they were when dragged the other way', () => {
    expect(settled(true, -300, 400)).toBe(true)
    expect(settled(false, 300, 400)).toBe(false)
  })
})

describe('the lanes under the finger', () => {
  it('come down from open as far as the finger drags them', () => {
    expect(followed(true, 120, 400)).toBe(120)
  })

  it('come up from folded as far as the finger drags them', () => {
    expect(followed(false, -150, 400)).toBe(250)
  })

  it('go no higher than open nor lower than folded', () => {
    expect(followed(true, -50, 400)).toBe(0)
    expect(followed(false, 80, 400)).toBe(400)
  })
})

describe('the scroll that centres the reading', () => {
  it('puts the reading halfway across the lanes shown, after the labels', () => {
    const scroll = centredScroll(0.5, 108, 2880, 390)

    expect(108 + 0.5 * 2880 - scroll).toBe(108 + (390 - 108) / 2)
  })

  it('asks for less than nothing at the start, which the browser clamps', () => {
    expect(centredScroll(0, 108, 2880, 390)).toBeLessThan(0)
  })
})

describe('the page the lanes turn as the line nears their edge', () => {
  // Labels of 108 pixels on a screen of 390: the lanes shown are 282 pixels wide.
  const lanes = { scroll: 0, maxScroll: 2000, label: 108, view: 390 }

  it('is none while the line is short of the edge', () => {
    expect(pageTurn(300, lanes)).toBeUndefined()
  })

  it('brings the line back near the start of the lanes shown once it is past the edge', () => {
    const turned = pageTurn(360, lanes)

    expect(turned).toBeCloseTo(360 - 108 - 0.15 * 282)
  })

  it('is none once the line is out of sight, where the reader scrolled away from it', () => {
    expect(pageTurn(500, lanes)).toBeUndefined()
    expect(pageTurn(50, { ...lanes, scroll: 400 })).toBeUndefined()
  })

  it('is none at the end, where the lanes go no further', () => {
    expect(pageTurn(460, { ...lanes, scroll: 100, maxScroll: 100 })).toBeUndefined()
  })
})

describe('a point among the lanes shown', () => {
  const lanes = { scroll: 200, maxScroll: 2000, label: 108, view: 390 }

  it('is shown between the labels and the edge of the screen', () => {
    expect(inView(400, lanes)).toBe(true)
    expect(inView(300, lanes)).toBe(false)
    expect(inView(600, lanes)).toBe(false)
  })
})

describe('what the lanes do for the reading line', () => {
  const lanes = { scroll: 0, maxScroll: 2000, label: 108, view: 390 }
  const quiet = { opening: false, revealing: false, turning: undefined, at: 10_000 }

  it('come to it in their middle as they open, wherever it is', () => {
    expect(following(200, lanes, { ...quiet, opening: true })).toEqual({ kind: 'centre' })
  })

  it('come to it when what the reader asked for left it out of sight', () => {
    expect(following(900, lanes, { ...quiet, revealing: true })).toEqual({ kind: 'centre' })
  })

  it('turn no page while the reader asks, even past the edge', () => {
    expect(following(360, lanes, { ...quiet, revealing: true })).toEqual({ kind: 'stay' })
  })

  it('turn a page as the line nears their edge', () => {
    expect(following(360, lanes, quiet)).toMatchObject({ kind: 'turn' })
  })

  it('wait while a page turn is on its way, and stop waiting once it has had its time', () => {
    const turning = { to: 210, since: 9_900 }

    expect(following(360, lanes, { ...quiet, turning })).toEqual({ kind: 'wait' })
    expect(following(360, lanes, { ...quiet, turning, at: 10_800 })).toMatchObject({ kind: 'turn' })
  })
})
