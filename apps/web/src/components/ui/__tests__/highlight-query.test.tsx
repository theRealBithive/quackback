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

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { renderWithIntl } from '@/test/render-with-intl'
import { HighlightQuery, emojiSuggestionLabel, splitQueryHighlights } from '../highlight-query'

describe('splitQueryHighlights', () => {
  it('returns the whole string unmatched when the query is empty (G7)', () => {
    expect(splitQueryHighlights(':crossed_fingers:', '')).toEqual([
      { text: ':crossed_fingers:', match: false },
    ])
  })

  it('highlights every case-insensitive hit (Slack :fingers → crossed_fingers) (G7)', () => {
    expect(splitQueryHighlights('crossed_fingers', 'Fingers')).toEqual([
      { text: 'crossed_', match: false },
      { text: 'fingers', match: true },
    ])
  })

  it('highlights a prefix hit (G7)', () => {
    expect(splitQueryHighlights('fingers_crossed', 'finger')).toEqual([
      { text: 'finger', match: true },
      { text: 's_crossed', match: false },
    ])
  })

  it('leaves the string unmatched when the query is not present (G7)', () => {
    expect(splitQueryHighlights('tada', 'finger')).toEqual([{ text: 'tada', match: false }])
  })
})

describe('emojiSuggestionLabel', () => {
  const crossed = { name: 'crossed_fingers', shortcodes: ['fingers_crossed'] }

  it('uses the primary shortcode when there is no query (G8)', () => {
    expect(emojiSuggestionLabel(crossed, '')).toBe('fingers_crossed')
  })

  it('prefers the name when it contains the query (Slack :crossed_fingers:) (G8)', () => {
    expect(emojiSuggestionLabel(crossed, 'fingers')).toBe('crossed_fingers')
  })

  it('falls back to a matching shortcode when the name does not match (G8)', () => {
    expect(emojiSuggestionLabel({ name: 'spock', shortcodes: ['vulcan'] }, 'vulc')).toBe('vulcan')
  })

  it('shows the name when the emoji carries no shortcode at all (G8)', () => {
    // 284 bundled items have a name that is not itself a shortcode; one with an
    // empty shortcode list has nothing else left to show.
    expect(emojiSuggestionLabel({ name: 'crossed_fingers', shortcodes: [] }, '')).toBe(
      'crossed_fingers'
    )
    expect(emojiSuggestionLabel({ name: 'crossed_fingers', shortcodes: [] }, 'zzz')).toBe(
      'crossed_fingers'
    )
  })
})

/**
 * Properties over (label, query).
 *
 * The alphabet is the one these labels are actually drawn from — emoji
 * shortcodes and slash-command titles: ASCII letters, digits, `_`, `-` and
 * spaces, plus a couple of accented letters so the case folding is not only
 * exercised on characters where it is a no-op. It deliberately excludes the
 * handful of code points whose `toLowerCase()` changes the string's *length*
 * (`İ` is the well-known one): this splitter indexes the lowercased copy into
 * the original, so a length-changing fold would mis-slice — a real limitation,
 * but not one a shortcode or a command title can reach.
 *
 * Repeats are frequent by construction (a 12-character alphabet over strings of
 * up to 24), so overlapping hits, adjacent hits and a hit at either end are all
 * reached rather than hoped for.
 */
describe('splitQueryHighlights — properties', () => {
  const LABEL_CHARS = 'abcABC_- 01äÄ'.split('')
  const label = fc.string({ unit: fc.constantFrom(...LABEL_CHARS), maxLength: 24 })
  const query = fc.string({ unit: fc.constantFrom(...LABEL_CHARS), maxLength: 5 })

  it('the pieces concatenate back to the label, character for character (G7)', () => {
    fc.assert(
      fc.property(label, query, (text, needle) => {
        const parts = splitQueryHighlights(text, needle)
        expect(parts.map((part) => part.text).join('')).toBe(text)
      })
    )
  })

  it('every highlighted piece is the query itself, ignoring case (G7)', () => {
    fc.assert(
      fc.property(label, query, (text, needle) => {
        const trimmed = needle.trim()
        for (const part of splitQueryHighlights(text, needle)) {
          if (!part.match) continue
          expect(part.text.toLowerCase()).toBe(trimmed.toLowerCase())
        }
      })
    )
  })

  it('no unhighlighted piece hides a hit (G7)', () => {
    fc.assert(
      fc.property(label, query, (text, needle) => {
        const trimmed = needle.trim().toLowerCase()
        if (!trimmed) return
        for (const part of splitQueryHighlights(text, needle)) {
          if (part.match) continue
          expect(part.text.toLowerCase()).not.toContain(trimmed)
        }
      })
    )
  })

  it('an empty or whitespace-only query highlights nothing (G7)', () => {
    fc.assert(
      fc.property(label, fc.constantFrom('', ' ', '   ', '\t', '\n  '), (text, blank) => {
        expect(splitQueryHighlights(text, blank)).toEqual([{ text, match: false }])
      })
    )
  })

  it('a label that holds the query has at least one highlighted piece (G7)', () => {
    fc.assert(
      fc.property(label, query, (text, needle) => {
        const trimmed = needle.trim()
        if (!trimmed) return
        const holdsIt = text.toLowerCase().includes(trimmed.toLowerCase())
        const highlighted = splitQueryHighlights(text, needle).some((part) => part.match)
        expect(highlighted).toBe(holdsIt)
      })
    )
  })
})

/**
 * Properties for the label an emoji row shows.
 *
 * Names and shortcodes come from a vocabulary that overlaps on purpose, so the
 * generator reaches a query the name answers, a query only a later shortcode
 * answers, a query nothing answers, and an item with several shortcodes where
 * the choice between them is what the contract decides.
 */
describe('emojiSuggestionLabel — properties', () => {
  const WORDS = ['crossed_fingers', 'fingers_crossed', 'tada', 'party_popper', 'ok', 'ok_hand']
  const item = fc.record({
    name: fc.constantFrom(...WORDS),
    shortcodes: fc.uniqueArray(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 }),
  })
  const query = fc.constantFrom('fingers', 'crossed', 'tada', 'ok', 'party', 'zzz', 'OK', '  ok ')

  it('a label that can contain the query does contain it (G8)', () => {
    fc.assert(
      fc.property(item, query, (emoji, typed) => {
        const q = typed.trim().toLowerCase()
        const reachable =
          emoji.name.toLowerCase().includes(q) ||
          emoji.shortcodes.some((code) => code.toLowerCase().includes(q))
        const label = emojiSuggestionLabel(emoji, typed)

        if (reachable) expect(label.toLowerCase()).toContain(q)
        else expect(label).toBe(emoji.shortcodes[0])
      })
    )
  })

  it('the name wins whenever the name contains the query (G8)', () => {
    fc.assert(
      fc.property(item, query, (emoji, typed) => {
        const q = typed.trim().toLowerCase()
        if (!emoji.name.toLowerCase().includes(q)) return
        expect(emojiSuggestionLabel(emoji, typed)).toBe(emoji.name)
      })
    )
  })

  it('otherwise the first matching shortcode wins, in the order they are listed (G8)', () => {
    fc.assert(
      fc.property(item, query, (emoji, typed) => {
        const q = typed.trim().toLowerCase()
        if (emoji.name.toLowerCase().includes(q)) return
        const firstMatch = emoji.shortcodes.find((code) => code.toLowerCase().includes(q))
        if (!firstMatch) return
        expect(emojiSuggestionLabel(emoji, typed)).toBe(firstMatch)
      })
    )
  })

  it('shortcodes appended after the chosen one never change the label (G8)', () => {
    fc.assert(
      fc.property(item, query, fc.constantFrom(...WORDS), (emoji, typed, extra) => {
        const widened = { ...emoji, shortcodes: [...emoji.shortcodes, extra] }
        const q = typed.trim().toLowerCase()
        const alreadyAnswered =
          emoji.name.toLowerCase().includes(q) ||
          emoji.shortcodes.some((code) => code.toLowerCase().includes(q))
        if (!alreadyAnswered) return
        expect(emojiSuggestionLabel(widened, typed)).toBe(emojiSuggestionLabel(emoji, typed))
      })
    )
  })

  it('the case and the surrounding whitespace of the query change nothing (G8)', () => {
    fc.assert(
      fc.property(item, query, (emoji, typed) => {
        const baseline = emojiSuggestionLabel(emoji, typed)
        for (const spelling of [typed.toUpperCase(), `  ${typed}`, `${typed}\t`]) {
          expect(emojiSuggestionLabel(emoji, spelling)).toBe(baseline)
        }
      })
    )
  })
})

describe('HighlightQuery', () => {
  it('marks the hit and leaves the rest of the label alone (G7)', () => {
    const { container } = renderWithIntl(
      <HighlightQuery text="crossed_fingers_crossed" query="Fingers" />
    )

    const spans = Array.from(container.querySelectorAll('span'))
    expect(spans.map((span) => span.textContent).join('')).toBe('crossed_fingers_crossed')

    const matched = spans.filter((span) => span.hasAttribute('data-query-match'))
    expect(matched).toHaveLength(1)
    expect(matched[0]!.textContent).toBe('fingers')
    expect(matched[0]!.className).toContain('text-amber-600')
    expect(matched[0]!.className).toContain('dark:text-amber-400')

    for (const span of spans) {
      if (span.hasAttribute('data-query-match')) continue
      expect(span.className).toBe('')
      expect(span.textContent?.toLowerCase()).not.toContain('fingers')
    }
  })

  it('renders one unmarked piece and no amber at all for a blank query (G7)', () => {
    const { container } = renderWithIntl(<HighlightQuery text="fingers_crossed" query="   " />)

    const spans = Array.from(container.querySelectorAll('span'))
    expect(spans).toHaveLength(1)
    expect(spans[0]!.textContent).toBe('fingers_crossed')
    expect(spans[0]!.hasAttribute('data-query-match')).toBe(false)
    expect(container.querySelector('.text-amber-600')).toBeNull()
  })
})
