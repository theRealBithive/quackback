// @vitest-environment happy-dom
/**
 * Batch C — group G: editor suggestion lists and emoji.
 *
 * The contract, copied verbatim. (The `(G1)`/`(G2)` suffixes that already sit in
 * `rich-text-editor.test.tsx` and `rich-text-editor-extensions.test.ts` belong to
 * an earlier batch's group E and mean something else; this block is batch C's.)
 *
 * G1 A key pressed in an open suggestion list either moves the highlight, confirms
 *    the highlighted entry, or is left to the editor. Arrow keys wrap at both ends,
 *    Home and End jump to the first and last entry, Enter and Tab confirm (Shift+Tab
 *    counts as Tab), and every other key is left to the editor.
 * G2 With an empty list no key does anything, and a confirm never fires without an
 *    entry under the highlight.
 * G3 Recently used emoji are remembered most-recent-first, without duplicates, at
 *    most eight. A blank glyph is not remembered, and unreadable, blocked or corrupt
 *    storage reads as "nothing remembered", never as an error.
 * G4 With nothing typed after the colon, the suggestions are the remembered emoji
 *    first, then the popular set, each glyph at most once, capped at the list size.
 * G5 With a query, only emoji whose name, shortcode or tag contains the query are
 *    suggested: an exact name or shortcode match first, then remembered emoji in
 *    recency order, then prefix matches, then the rest; capped, and only emoji that
 *    have a glyph.
 * G6 The letter case and surrounding whitespace of a query never change the
 *    suggestions.
 * G7 Highlighting a query inside a label splits the label into pieces that
 *    concatenate back to the label exactly; every highlighted piece equals the query
 *    ignoring case, no unhighlighted piece contains the query, and an empty or
 *    whitespace query highlights nothing.
 * G8 The label shown for an emoji suggestion is the emoji's name when the name
 *    contains the query, otherwise the first shortcode that contains it, otherwise
 *    its primary shortcode.
 * G9 Looking an emoji up by its canonical name resolves the same glyph as looking it
 *    up by any of its shortcodes; an unknown name resolves to nothing. (Also feeds
 *    the server-side markdown serializer.)
 * G10 Typing `:shortcode:` in the editor inserts that emoji, remembers it as recently
 *    used and keeps the surrounding text marks; an unknown shortcode inserts nothing
 *    and leaves the text as typed.
 * G11 Choosing an entry from the emoji or slash list, by mouse or by keyboard, runs
 *    that entry's command exactly once; a chosen emoji is remembered as recently used
 *    before it is inserted.
 * G12 The emoji list labels its leading remembered entries as recent only on a bare
 *    colon; with a query nothing is labelled recent.
 * G13 A suggestion popup sits above the caret it annotates and flips below when there
 *    is no room; it never grows down over the composer (its height is capped, at
 *    least 96px, and it scrolls inside); it follows the caret while open and stops
 *    following when closed or re-attached elsewhere.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import {
  SUGGESTION_PLACEMENT,
  SUGGESTION_POPUP_ATTR,
  attachSuggestionPopupPosition,
  createSuggestionPopup,
  createSuggestionPositioner,
  hasOpenSuggestionPopup,
  markSuggestionPopup,
} from '../suggestion-popup'

/**
 * Floating UI is the seam. `computePosition` resolves a fixed point so the
 * position the module writes is readable, `autoUpdate` hands back a recorded
 * stop function so attaching and detaching are observable, and each middleware
 * factory returns a tagged object so the middleware list can be read back — the
 * `size` one keeps its options, which is the only way to reach its `apply` from
 * outside.
 */
vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(async () => ({ x: 120, y: 48 })),
  autoUpdate: vi.fn(() => vi.fn()),
  offset: vi.fn((value: unknown) => ({ name: 'offset', value })),
  flip: vi.fn((options: unknown) => ({ name: 'flip', options })),
  shift: vi.fn((options: unknown) => ({ name: 'shift', options })),
  size: vi.fn((options: unknown) => ({ name: 'size', options })),
}))

type SizeApply = (args: { availableHeight: number; elements: { floating: HTMLElement } }) => void

const caretRect = (top = 400) => new DOMRect(200, top, 1, 18)

/** The reference `autoUpdate` was handed, i.e. what floating-ui would measure. */
function referenceOf(call: number) {
  return vi.mocked(autoUpdate).mock.calls[call]![0] as {
    getBoundingClientRect: () => DOMRect
  }
}

/** Run the callback `autoUpdate` was given — what a scroll or a resize does. */
async function runAutoUpdate(call = 0): Promise<void> {
  const update = vi.mocked(autoUpdate).mock.calls[call]![2] as () => void
  update()
  await Promise.resolve()
  await Promise.resolve()
}

function stopOf(call: number) {
  return vi.mocked(autoUpdate).mock.results[call]!.value as ReturnType<typeof vi.fn>
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('attachSuggestionPopupPosition', () => {
  it('positions the popup from the caret rect it is given (G13)', async () => {
    const floating = document.createElement('div')
    const rect = caretRect()

    attachSuggestionPopupPosition(floating, () => rect)
    await runAutoUpdate()

    expect(computePosition).toHaveBeenCalledOnce()
    const [reference, element, options] = vi.mocked(computePosition).mock.calls[0]!
    expect((reference as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect()).toBe(
      rect
    )
    expect(element).toBe(floating)
    expect(options).toMatchObject({ strategy: 'fixed', placement: SUGGESTION_PLACEMENT })
    expect(floating.style.left).toBe('120px')
    expect(floating.style.top).toBe('48px')
  })

  it('sits above the caret and is allowed to flip below it (G13)', async () => {
    attachSuggestionPopupPosition(document.createElement('div'), () => caretRect())
    await runAutoUpdate()

    // 'top-start' is "above the caret"; `flip` is what moves it below when the
    // caret is near the top of the viewport.
    expect(SUGGESTION_PLACEMENT).toBe('top-start')
    const middleware = vi.mocked(computePosition).mock.calls[0]![2]!.middleware!
    expect(middleware.map((entry) => (entry as { name: string }).name)).toEqual([
      'offset',
      'flip',
      'shift',
      'size',
    ])
    expect(offset).toHaveBeenCalledWith(8)
    expect(flip).toHaveBeenCalledWith({ padding: 8 })
    // Horizontal slide only: sliding on the main axis would walk the menu down
    // onto the composer it annotates.
    expect(shift).toHaveBeenCalledWith({ padding: 8, mainAxis: false })
  })

  it('caps its height at the room available and scrolls inside (G13)', async () => {
    attachSuggestionPopupPosition(document.createElement('div'), () => caretRect())
    await runAutoUpdate()

    const apply = (vi.mocked(size).mock.calls[0]![0] as { apply: SizeApply }).apply
    const floating = document.createElement('div')

    apply({ availableHeight: 240, elements: { floating } })
    expect(floating.style.maxHeight).toBe('240px')
    expect(floating.style.overflowY).toBe('auto')
  })

  it('never shrinks below 96px, however little room there is (G13)', async () => {
    attachSuggestionPopupPosition(document.createElement('div'), () => caretRect())
    await runAutoUpdate()

    const apply = (vi.mocked(size).mock.calls[0]![0] as { apply: SizeApply }).apply
    for (const availableHeight of [0, 12, 95, 96, 97]) {
      const floating = document.createElement('div')
      apply({ availableHeight, elements: { floating } })
      expect(floating.style.maxHeight).toBe(`${Math.max(96, availableHeight)}px`)
      expect(floating.style.overflowY).toBe('auto')
    }
  })

  it('follows the caret: every update re-reads the live rect (G13)', async () => {
    const floating = document.createElement('div')
    let rect = caretRect(400)

    attachSuggestionPopupPosition(floating, () => rect)
    await runAutoUpdate()
    expect(referenceOf(0).getBoundingClientRect()).toBe(rect)

    rect = caretRect(120)
    await runAutoUpdate()
    expect(referenceOf(0).getBoundingClientRect()).toBe(rect)
    expect(computePosition).toHaveBeenCalledTimes(2)
  })

  it('leaves the popup where it is when there is no caret rect to read (G13)', async () => {
    const floating = document.createElement('div')
    floating.style.left = '7px'
    floating.style.top = '9px'

    attachSuggestionPopupPosition(floating, () => null)
    await runAutoUpdate()

    expect(computePosition).not.toHaveBeenCalled()
    expect(floating.style.left).toBe('7px')
    expect(floating.style.top).toBe('9px')
    // floating-ui still needs a rect from the virtual reference; an empty one
    // keeps it from measuring a stale caret.
    const empty = referenceOf(0).getBoundingClientRect()
    expect(empty.width).toBe(0)
    expect(empty.height).toBe(0)
  })

  it('does not follow anything when there is no rect getter at all (G13)', () => {
    const floating = document.createElement('div')

    const stop = attachSuggestionPopupPosition(floating, null)

    expect(autoUpdate).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })
})

describe('createSuggestionPositioner', () => {
  it('stops following the old caret when it is attached somewhere else (G13)', () => {
    const positioner = createSuggestionPositioner()
    const first = document.createElement('div')
    const second = document.createElement('div')

    positioner.attach(first, () => caretRect())
    expect(autoUpdate).toHaveBeenCalledOnce()
    expect(stopOf(0)).not.toHaveBeenCalled()

    positioner.attach(second, () => caretRect(80))
    expect(stopOf(0)).toHaveBeenCalledOnce()
    expect(autoUpdate).toHaveBeenCalledTimes(2)
    expect(vi.mocked(autoUpdate).mock.calls[1]![1]).toBe(second)
  })

  it('stops following when the popup closes, and stays stopped (G13)', () => {
    const positioner = createSuggestionPositioner()

    positioner.attach(document.createElement('div'), () => caretRect())
    positioner.detach()
    expect(stopOf(0)).toHaveBeenCalledOnce()

    positioner.detach()
    expect(stopOf(0)).toHaveBeenCalledOnce()
  })

  it('detaching before anything was attached is not an error (G13)', () => {
    const positioner = createSuggestionPositioner()

    expect(() => positioner.detach()).not.toThrow()
    expect(autoUpdate).not.toHaveBeenCalled()
  })

  it('re-attaching after a detach follows the new caret again (G13)', () => {
    const positioner = createSuggestionPositioner()
    const el = document.createElement('div')

    positioner.attach(el, () => caretRect())
    positioner.detach()
    positioner.attach(el, () => caretRect(60))

    expect(autoUpdate).toHaveBeenCalledTimes(2)
    expect(stopOf(0)).toHaveBeenCalledOnce()
    expect(stopOf(1)).not.toHaveBeenCalled()
  })
})

describe('the popup element itself', () => {
  it('is a fixed, body-level container carrying the suggestion marker (G13)', () => {
    const popup = createSuggestionPopup()

    expect(popup.style.position).toBe('fixed')
    expect(popup.style.zIndex).toBe('50')
    expect(popup.style.pointerEvents).toBe('auto')
    expect(popup.hasAttribute(SUGGESTION_POPUP_ATTR)).toBe(true)
  })

  it('marks an element a caller built itself and hands it back (G13)', () => {
    const el = document.createElement('span')

    expect(markSuggestionPopup(el)).toBe(el)
    expect(el.getAttribute(SUGGESTION_POPUP_ATTR)).toBe('')
  })

  it('a marked element that is not showing does not count as an open popup (G13)', () => {
    expect(hasOpenSuggestionPopup()).toBe(false)

    const popup = createSuggestionPopup()
    popup.checkVisibility = () => false
    document.body.appendChild(popup)
    expect(hasOpenSuggestionPopup()).toBe(false)

    popup.checkVisibility = () => true
    expect(hasOpenSuggestionPopup()).toBe(true)
  })

  it('falls back to measuring the element where checkVisibility is missing (G13)', () => {
    const popup = createSuggestionPopup()
    document.body.appendChild(popup)
    Object.defineProperty(popup, 'checkVisibility', { value: undefined, configurable: true })
    popup.getClientRects = (() => []) as unknown as Element['getClientRects']
    expect(hasOpenSuggestionPopup()).toBe(false)

    popup.getClientRects = (() => [
      new DOMRect(0, 0, 10, 10),
    ]) as unknown as Element['getClientRects']
    expect(hasOpenSuggestionPopup()).toBe(true)
  })
})
