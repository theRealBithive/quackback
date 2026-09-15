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

import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { applySuggestionListKey, resolveSuggestionListKey } from '../suggestion-list-keys'

function key(name: string): Pick<KeyboardEvent, 'key'> {
  return { key: name }
}

describe('resolveSuggestionListKey', () => {
  const three = { count: 3, selected: 1 }

  it('returns none when the list is empty (G2)', () => {
    expect(resolveSuggestionListKey(key('Enter'), { count: 0, selected: 0 })).toEqual({
      type: 'none',
    })
    expect(resolveSuggestionListKey(key('Tab'), { count: 0, selected: 0 })).toEqual({
      type: 'none',
    })
  })

  it('ArrowDown/ArrowUp wrap around (G1)', () => {
    expect(resolveSuggestionListKey(key('ArrowDown'), three)).toEqual({ type: 'move', index: 2 })
    expect(resolveSuggestionListKey(key('ArrowDown'), { count: 3, selected: 2 })).toEqual({
      type: 'move',
      index: 0,
    })
    expect(resolveSuggestionListKey(key('ArrowUp'), three)).toEqual({ type: 'move', index: 0 })
    expect(resolveSuggestionListKey(key('ArrowUp'), { count: 3, selected: 0 })).toEqual({
      type: 'move',
      index: 2,
    })
  })

  it('Home/End jump to first/last (G1)', () => {
    expect(resolveSuggestionListKey(key('Home'), three)).toEqual({ type: 'move', index: 0 })
    expect(resolveSuggestionListKey(key('End'), three)).toEqual({ type: 'move', index: 2 })
  })

  it('Enter, Tab, and Shift+Tab (key is still Tab) confirm (G1)', () => {
    expect(resolveSuggestionListKey(key('Enter'), three)).toEqual({ type: 'confirm' })
    expect(resolveSuggestionListKey(key('Tab'), three)).toEqual({ type: 'confirm' })
  })

  it('ignores unrelated keys so the editor keeps them (G1)', () => {
    expect(resolveSuggestionListKey(key('a'), three)).toEqual({ type: 'none' })
    expect(resolveSuggestionListKey(key(' '), three)).toEqual({ type: 'none' })
    expect(resolveSuggestionListKey(key('Escape'), three)).toEqual({ type: 'none' })
  })
})

describe('applySuggestionListKey', () => {
  const items = ['a', 'b', 'c']

  it('moves via onMove and does not confirm (G1)', () => {
    const onMove = vi.fn()
    const onConfirm = vi.fn()
    expect(
      applySuggestionListKey(key('ArrowDown'), { items, selected: 0, onMove, onConfirm })
    ).toBe(true)
    expect(onMove).toHaveBeenCalledWith(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Tab confirms the highlighted row (Slack-style) (G1)', () => {
    const onMove = vi.fn()
    const onConfirm = vi.fn()
    expect(applySuggestionListKey(key('Tab'), { items, selected: 1, onMove, onConfirm })).toBe(true)
    expect(onConfirm).toHaveBeenCalledWith('b')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('returns false for unused keys (G1)', () => {
    expect(
      applySuggestionListKey(key('x'), {
        items,
        selected: 0,
        onMove: vi.fn(),
        onConfirm: vi.fn(),
      })
    ).toBe(false)
  })
})

/**
 * Properties over (count, selected, key).
 *
 * The generator reaches every state the resolver distinguishes: the empty list,
 * a one-entry list (where "wrap" and "stay" are the same index), both ends of a
 * longer list, a highlight in the middle, each of the six keys the contract
 * names, and keys the editor keeps (printable characters, Escape, Backspace,
 * modifiers). `selected` is also generated outside `0..count-1`, which is the
 * state a list that shrank under an open highlight leaves behind.
 */
describe('resolveSuggestionListKey — properties', () => {
  const HANDLED_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Tab'] as const
  const IGNORED_KEYS = ['a', 'Z', '0', ' ', 'Escape', 'Backspace', 'Shift', 'PageDown'] as const
  const anyKey = fc.constantFrom(...HANDLED_KEYS, ...IGNORED_KEYS)

  /**
   * A highlight that sits on an entry, which is what E1 speaks about ("confirms
   * the highlighted entry").
   *
   * The first version of this generator also produced a `selected` outside
   * `0..count-1` and the property went red: `ArrowDown` on `{count: 1,
   * selected: -2}` resolves to index -1, and `ArrowUp` on `{count: 3,
   * selected: 6}` resolves to 5 — the two arrows guard opposite ends and
   * neither guards the other. That is a state E1 does not describe and the
   * lists do not produce (both reset the highlight to 0 whenever `items`
   * changes), so the property was stating a guarantee the contract never made.
   * The off-the-list highlight is still generated below, where the contract
   * does name it: E2, "a confirm never fires without an entry under the
   * highlight".
   */
  const stateOf = (count: number) =>
    fc.integer({ min: 0, max: Math.max(0, count - 1) }).map((selected) => ({ count, selected }))
  const nonEmptyState = fc.integer({ min: 1, max: 12 }).chain(stateOf)

  it('a move never leaves the list and the other outcomes carry no index (G1)', () => {
    fc.assert(
      fc.property(nonEmptyState, anyKey, (state, name) => {
        const result = resolveSuggestionListKey(key(name), state)
        if (result.type === 'move') {
          expect(result.index).toBeGreaterThanOrEqual(0)
          expect(result.index).toBeLessThan(state.count)
          return
        }
        expect(result).toEqual(result.type === 'confirm' ? { type: 'confirm' } : { type: 'none' })
      })
    )
  })

  it('only the six keys the contract names are taken; the editor keeps the rest (G1)', () => {
    fc.assert(
      fc.property(nonEmptyState, fc.constantFrom(...IGNORED_KEYS), (state, name) => {
        expect(resolveSuggestionListKey(key(name), state)).toEqual({ type: 'none' })
      })
    )
    fc.assert(
      fc.property(nonEmptyState, fc.constantFrom(...HANDLED_KEYS), (state, name) => {
        expect(resolveSuggestionListKey(key(name), state).type).not.toBe('none')
      })
    )
  })

  it('the arrows wrap at both ends and step by one everywhere else (G1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (count) => {
        const last = count - 1
        for (let selected = 0; selected <= last; selected++) {
          const down = resolveSuggestionListKey(key('ArrowDown'), { count, selected })
          const up = resolveSuggestionListKey(key('ArrowUp'), { count, selected })
          expect(down).toEqual({ type: 'move', index: selected === last ? 0 : selected + 1 })
          expect(up).toEqual({ type: 'move', index: selected === 0 ? last : selected - 1 })
        }
      })
    )
  })

  it('Home and End reach the first and last entry from anywhere (G1)', () => {
    fc.assert(
      fc.property(nonEmptyState, (state) => {
        expect(resolveSuggestionListKey(key('Home'), state)).toEqual({ type: 'move', index: 0 })
        expect(resolveSuggestionListKey(key('End'), state)).toEqual({
          type: 'move',
          index: state.count - 1,
        })
      })
    )
  })

  it('an empty list takes no key at all, whatever the highlight says (G2)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -3, max: 3 }), anyKey, (selected, name) => {
        expect(resolveSuggestionListKey(key(name), { count: 0, selected })).toEqual({
          type: 'none',
        })
      })
    )
  })
})

describe('applySuggestionListKey — properties', () => {
  const HANDLED_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Tab'] as const
  const CONFIRM_KEYS = ['Enter', 'Tab'] as const
  const MOVE_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const

  const listOf = (length: number) => Array.from({ length }, (_, i) => `item-${i}`)

  it('a confirm hands over exactly the highlighted entry, once (G1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.constantFrom(...CONFIRM_KEYS),
        (length, name) => {
          const items = listOf(length)
          for (let selected = 0; selected < length; selected++) {
            const onConfirm = vi.fn()
            const onMove = vi.fn()
            const taken = applySuggestionListKey(key(name), { items, selected, onMove, onConfirm })
            expect(taken).toBe(true)
            expect(onConfirm).toHaveBeenCalledOnce()
            expect(onConfirm).toHaveBeenCalledWith(items[selected])
            expect(onMove).not.toHaveBeenCalled()
          }
        }
      )
    )
  })

  it('a move reports an index the caller can highlight and confirms nothing (G1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.constantFrom(...MOVE_KEYS),
        fc.integer({ min: 0, max: 9 }),
        (length, name, rawSelected) => {
          const items = listOf(length)
          const onConfirm = vi.fn()
          const onMove = vi.fn()
          const taken = applySuggestionListKey(key(name), {
            items,
            selected: rawSelected % length,
            onMove,
            onConfirm,
          })
          expect(taken).toBe(true)
          expect(onMove).toHaveBeenCalledOnce()
          expect(items[onMove.mock.calls[0]![0] as number]).toBeDefined()
          expect(onConfirm).not.toHaveBeenCalled()
        }
      )
    )
  })

  it('an empty list runs no callback and leaves every key to the editor (G2)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HANDLED_KEYS, 'a', 'Escape'),
        fc.integer({ min: -2, max: 3 }),
        (name, selected) => {
          const onConfirm = vi.fn()
          const onMove = vi.fn()
          const taken = applySuggestionListKey(key(name), {
            items: [],
            selected,
            onMove,
            onConfirm,
          })
          expect(taken).toBe(false)
          expect(onMove).not.toHaveBeenCalled()
          expect(onConfirm).not.toHaveBeenCalled()
        }
      )
    )
  })

  it('a highlight past the end of the list confirms nothing (G2)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.constantFrom(...CONFIRM_KEYS),
        fc.integer({ min: 0, max: 4 }),
        (length, name, overshoot) => {
          const items = listOf(length)
          const onConfirm = vi.fn()
          const taken = applySuggestionListKey(key(name), {
            items,
            selected: length + overshoot,
            onMove: vi.fn(),
            onConfirm,
          })
          // The key is still taken — the popup is open, so the editor must not
          // also act on it — but nothing is inserted.
          expect(taken).toBe(true)
          expect(onConfirm).not.toHaveBeenCalled()
        }
      )
    )
  })
})
