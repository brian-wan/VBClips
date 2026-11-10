import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchKey, isTextInput, type EditorShortcutHandlers, type KeyPress } from './keys'

const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({
  key,
  code: key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key,
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
})

function handlers() {
  const calls: string[] = []
  const h: EditorShortcutHandlers = {
    mark: () => calls.push('mark'),
    togglePlay: () => calls.push('togglePlay'),
    seekBy: (s) => calls.push(`seekBy ${s}`),
    prevClip: () => calls.push('prevClip'),
    nextClip: () => calls.push('nextClip'),
    cycleSpeed: () => calls.push('cycleSpeed'),
    editSelected: () => calls.push('editSelected'),
    deleteSelected: () => calls.push('deleteSelected'),
    undo: () => calls.push('undo'),
    redo: () => calls.push('redo'),
    escape: () => calls.push('escape'),
    showShortcuts: () => calls.push('showShortcuts'),
  }
  return { h, calls }
}

describe('dispatchKey', () => {
  it.each([
    [' ', 'mark'],
    ['k', 'togglePlay'],
    ['K', 'togglePlay'],
    ['ArrowLeft', 'seekBy -5'],
    ['ArrowRight', 'seekBy 5'],
    ['ArrowUp', 'prevClip'],
    ['[', 'prevClip'],
    ['ArrowDown', 'nextClip'],
    [']', 'nextClip'],
    ['s', 'cycleSpeed'],
    ['e', 'editSelected'],
    ['Delete', 'deleteSelected'],
    ['Backspace', 'deleteSelected'],
    ['Escape', 'escape'],
    ['?', 'showShortcuts'],
  ])('maps %s to %s', (key, handler) => {
    const { h, calls } = handlers()
    expect(dispatchKey(press(key), h)).toBe(true)
    expect(calls).toEqual([handler])
  })

  it('swallows a held Space without marking again', () => {
    const { h, calls } = handlers()
    expect(dispatchKey(press(' ', { repeat: true }), h)).toBe(true)
    expect(calls).toEqual([])
  })

  it('undoes with Cmd or Ctrl+Z and redoes with Shift', () => {
    const { h, calls } = handlers()
    dispatchKey(press('z', { metaKey: true }), h)
    dispatchKey(press('z', { ctrlKey: true }), h)
    dispatchKey(press('Z', { metaKey: true, shiftKey: true }), h)
    expect(calls).toEqual(['undo', 'undo', 'redo'])
  })

  it('leaves other chords and unbound keys to the browser', () => {
    const { h, calls } = handlers()
    expect(dispatchKey(press('k', { metaKey: true }), h)).toBe(false)
    expect(dispatchKey(press('z', { metaKey: true, altKey: true }), h)).toBe(false)
    expect(dispatchKey(press('ArrowLeft', { altKey: true }), h)).toBe(false)
    expect(dispatchKey(press('x'), h)).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('isTextInput', () => {
  // Stand-ins for the DOM classes isTextInput checks against; tests run without a DOM.
  class Element {
    isContentEditable = false
  }
  class Input extends Element {
    type: string
    constructor(type: string) {
      super()
      this.type = type
    }
  }
  class TextArea extends Element {}
  class Select extends Element {}
  class Button extends Element {}

  beforeEach(() => {
    vi.stubGlobal('HTMLElement', Element)
    vi.stubGlobal('HTMLInputElement', Input)
    vi.stubGlobal('HTMLTextAreaElement', TextArea)
    vi.stubGlobal('HTMLSelectElement', Select)
  })
  afterEach(() => vi.unstubAllGlobals())

  const as = (target: object) => target as EventTarget

  it('is true where typing happens', () => {
    expect(isTextInput(as(new Input('text')))).toBe(true)
    expect(isTextInput(as(new Input('search')))).toBe(true)
    expect(isTextInput(as(new TextArea()))).toBe(true)
    expect(isTextInput(as(new Select()))).toBe(true)
    expect(isTextInput(as(Object.assign(new Element(), { isContentEditable: true })))).toBe(true)
  })

  it('is false for controls that take no text, so shortcuts still work there', () => {
    expect(isTextInput(as(new Input('radio')))).toBe(false)
    expect(isTextInput(as(new Input('file')))).toBe(false)
    expect(isTextInput(as(new Button()))).toBe(false)
    expect(isTextInput(null)).toBe(false)
  })
})
