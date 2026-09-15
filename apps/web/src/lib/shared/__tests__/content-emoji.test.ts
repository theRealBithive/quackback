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
import { defaultEmojis, lookupEmoji, type EmojiItem } from '../content-emoji'

describe('lookupEmoji', () => {
  it('resolves a shortcode that is also the canonical name (tada) (G9)', () => {
    expect(lookupEmoji('tada')?.emoji).toBe('🎉')
  })

  it('resolves crossed_fingers by canonical name (not in shortcodes[]) (G9)', () => {
    // TipTap stores attrs.name = "crossed_fingers"; the only shortcode is
    // "fingers_crossed". Looking up by name must still return the glyph.
    const byName = lookupEmoji('crossed_fingers')
    expect(byName?.emoji).toBe('🤞')
    expect(byName?.name).toBe('crossed_fingers')
  })

  it('resolves the Slack-style fingers_crossed shortcode to the same glyph (G9)', () => {
    const byShortcode = lookupEmoji('fingers_crossed')
    expect(byShortcode?.emoji).toBe('🤞')
    expect(byShortcode?.name).toBe('crossed_fingers')
  })

  it('returns undefined for an unknown shortcode (G9)', () => {
    expect(lookupEmoji('not_a_real_emoji_zzz')).toBeUndefined()
  })
})

/**
 * The whole bundled dataset, not a hand-picked pair.
 *
 * E9 assumes a key names one emoji. Measured against the shipped dataset that
 * is true of all but 24 keys: 1949 bundled items carry a glyph, and 6 canonical
 * names (`point_up`, `pouting_face`, `train`, `umbrella`, `satellite`, `up`)
 * plus 18 shortcodes (`dog` on `dog2`, `cat` on `cat2`, `horse` on `racehorse`,
 * …) are claimed by two items at once. `lookupEmoji` is a first-wins `find`, so
 * for those 24 the name and the shortcode genuinely resolve to different
 * glyphs — a property of the upstream dataset rather than of this module, and
 * one no lookup by string can fix.
 *
 * So the sweep below asserts E9 where its assumption holds (every unambiguous
 * key), and asserts separately that the ambiguous ones still resolve — to one
 * item, the same one every time, never to nothing. A serializer that stored
 * `dog` yesterday reads back the same glyph today; that is the promise E9 is
 * there for.
 */
describe('lookupEmoji — every bundled emoji', () => {
  const withGlyph = defaultEmojis.filter((item): item is EmojiItem => Boolean(item.emoji))

  /** Every name and shortcode, with the items that claim it. */
  function claimantsByKey(): Map<string, EmojiItem[]> {
    const claims = new Map<string, EmojiItem[]>()
    for (const item of withGlyph) {
      for (const key of [item.name, ...item.shortcodes]) {
        const existing = claims.get(key)
        if (existing) existing.push(item)
        else claims.set(key, [item])
      }
    }
    return claims
  }

  it('the dataset is worth sweeping: it is large and every entry has a glyph (G9)', () => {
    expect(withGlyph.length).toBeGreaterThan(1000)
    expect(withGlyph.length).toBe(defaultEmojis.length)
  })

  it('an unambiguous name and each of its shortcodes resolve the same glyph (G9)', () => {
    const claims = claimantsByKey()
    const disagreements: string[] = []

    for (const item of withGlyph) {
      for (const key of [item.name, ...item.shortcodes]) {
        if (claims.get(key)!.length > 1) continue
        const resolved = lookupEmoji(key)
        if (!resolved || resolved.emoji !== item.emoji || resolved.name !== item.name) {
          disagreements.push(`${item.name} via ${key} → ${String(resolved?.name)}`)
        }
      }
    }

    expect(disagreements).toEqual([])
  })

  it('a key two emoji claim still resolves, to one of them, always the same one (G9)', () => {
    const claims = claimantsByKey()
    const shared = Array.from(claims.entries()).filter(([, items]) => items.length > 1)
    expect(shared.length).toBeGreaterThan(0)

    for (const [key, claimants] of shared) {
      const resolved = lookupEmoji(key)
      expect(resolved, `no emoji at all for ${key}`).toBeDefined()
      expect(resolved!.emoji).toBeTruthy()
      expect(claimants.map((item) => item.name)).toContain(resolved!.name)
      expect(lookupEmoji(key)).toBe(resolved)
    }
  })

  it('every bundled name resolves to something with a glyph (G9)', () => {
    const unresolved = withGlyph.filter((item) => !lookupEmoji(item.name)?.emoji)
    expect(unresolved.map((item) => item.name)).toEqual([])
  })

  it('names nothing in the dataset claims resolve to nothing (G9)', () => {
    for (const unknown of ['', 'not_a_real_emoji_zzz', 'TADA', ':tada:', 'tada ']) {
      expect(lookupEmoji(unknown)).toBeUndefined()
    }
  })
})
