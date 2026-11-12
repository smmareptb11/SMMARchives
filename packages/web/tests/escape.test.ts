import { describe, expect, it } from 'vitest'

import { escapeCloses, type EscapePress } from '../src/map/escape.ts'

const escape: EscapePress = { key: 'Escape', isComposing: false, defaultPrevented: false }
const on = (tagName: string, type?: string) => ({ tagName, type, isContentEditable: false })

describe('Escape, on the window in front', () => {
  /** What a click in the history or on a lane leaves focused: the button clicked. */
  it('closes it from the button that opened it', () => {
    expect(escapeCloses(escape, on('BUTTON'))).toBe(true)
  })

  it('closes it from the page itself, and from no element at all', () => {
    expect(escapeCloses(escape, on('BODY'))).toBe(true)
    expect(escapeCloses(escape, null)).toBe(true)
  })

  it('closes it from a checkbox, which takes no typing', () => {
    expect(escapeCloses(escape, on('INPUT', 'checkbox'))).toBe(true)
  })

  it('leaves it open while typing in a field', () => {
    expect(escapeCloses(escape, on('INPUT', 'text'))).toBe(false)
    expect(escapeCloses(escape, on('INPUT', 'datetime-local'))).toBe(false)
    expect(escapeCloses(escape, on('TEXTAREA'))).toBe(false)
    expect(escapeCloses(escape, on('SELECT'))).toBe(false)
    expect(escapeCloses(escape, { tagName: 'DIV', isContentEditable: true })).toBe(false)
  })

  it('leaves it open while a composition is under way', () => {
    expect(escapeCloses({ ...escape, isComposing: true }, on('BUTTON'))).toBe(false)
  })

  it('leaves it open when something already handled the key', () => {
    expect(escapeCloses({ ...escape, defaultPrevented: true }, on('BUTTON'))).toBe(false)
  })

  it('does nothing on another key', () => {
    expect(escapeCloses({ ...escape, key: 'Enter' }, on('BUTTON'))).toBe(false)
  })
})
