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

import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import fc from 'fast-check'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import {
  EMOJI_RECENT_STORAGE_KEY,
  MAX_RECENT_EMOJIS,
  POPULAR_EMOJI_SHORTCODES,
  readRecentEmojis,
  recommendEmojiItems,
  recordRecentEmoji,
  type RankableEmoji,
} from '../emoji-recommendations'

installInMemoryLocalStorage()

const catalog: RankableEmoji[] = [
  { name: 'smile', emoji: '😄', shortcodes: ['smile'], tags: ['happy'] },
  { name: 'tada', emoji: '🎉', shortcodes: ['tada'], tags: ['party'] },
  {
    name: 'crossed_fingers',
    emoji: '🤞',
    shortcodes: ['fingers_crossed'],
    tags: ['finger', 'luck'],
  },
  {
    name: 'raised_hand_with_fingers_splayed',
    emoji: '🖐️',
    shortcodes: ['raised_hand_with_fingers_splayed'],
    tags: ['finger', 'hand'],
  },
  { name: 'fire', emoji: '🔥', shortcodes: ['fire'], tags: ['hot'] },
  { name: 'thumbsup', emoji: '👍', shortcodes: ['thumbsup', '+1'], tags: ['yes'] },
]

const lookup = (shortcode: string) =>
  catalog.find((e) => e.name === shortcode || e.shortcodes.includes(shortcode))

describe('recordRecentEmoji / readRecentEmojis', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns [] when nothing has been recorded (G3)', () => {
    expect(readRecentEmojis()).toEqual([])
  })

  it('moves the latest glyph to the front and dedupes (G3)', () => {
    recordRecentEmoji('🎉')
    recordRecentEmoji('🤞')
    recordRecentEmoji('🎉')
    expect(readRecentEmojis()).toEqual(['🎉', '🤞'])
  })

  it('caps recents at MAX_RECENT_EMOJIS (G3)', () => {
    for (let i = 0; i < MAX_RECENT_EMOJIS + 4; i++) {
      recordRecentEmoji(String.fromCodePoint(0x1f600 + i))
    }
    expect(readRecentEmojis()).toHaveLength(MAX_RECENT_EMOJIS)
  })

  it('ignores blank glyphs and corrupt storage (G3)', () => {
    recordRecentEmoji('   ')
    expect(readRecentEmojis()).toEqual([])
    window.localStorage.setItem('quackback:emoji-recent', '{not json')
    expect(readRecentEmojis()).toEqual([])
  })

  it('caps the READ at MAX_RECENT_EMOJIS even when more are stored, keeping stored order (G3)', () => {
    const storedGlyphs = ['🎉', '🤞', '🔥', '😄', '👍', '❤️', '🚀', '🌮', '🎊', '🙏']
    window.localStorage.setItem(EMOJI_RECENT_STORAGE_KEY, JSON.stringify(storedGlyphs))

    expect(readRecentEmojis()).toEqual(storedGlyphs.slice(0, MAX_RECENT_EMOJIS))
  })

  it('a blank glyph does not consume a remembered slot — storage is left untouched (G3)', () => {
    const eightGlyphs = ['🎉', '🤞', '🔥', '😄', '👍', '❤️', '🚀', '🌮']
    window.localStorage.setItem(EMOJI_RECENT_STORAGE_KEY, JSON.stringify(eightGlyphs))

    recordRecentEmoji('   ')

    const stored = JSON.parse(window.localStorage.getItem(EMOJI_RECENT_STORAGE_KEY)!)
    expect(stored).toEqual(eightGlyphs)
    expect(readRecentEmojis()).toEqual(eightGlyphs)
  })

  it('caps the WRITE at MAX_RECENT_EMOJIS in the stored JSON, not only on read-back (G3)', () => {
    const nineDistinctGlyphs = ['🎉', '🤞', '🔥', '😄', '👍', '❤️', '🚀', '🌮', '🎊']
    for (const glyph of nineDistinctGlyphs) recordRecentEmoji(glyph)

    const stored = JSON.parse(window.localStorage.getItem(EMOJI_RECENT_STORAGE_KEY)!)
    expect(stored).toHaveLength(MAX_RECENT_EMOJIS)
  })
})

describe('recommendEmojiItems', () => {
  const popular = ['smile', 'tada', 'thumbsup', 'fire', 'crossed_fingers'] as const

  it('on a bare query, lists recents then popular defaults (G4)', () => {
    const items = recommendEmojiItems('', {
      recents: ['🤞', '🔥'],
      popularShortcodes: popular,
      lookup,
      catalog,
      max: 12,
    })
    expect(items.map((i) => i.emoji)).toEqual(['🤞', '🔥', '😄', '🎉', '👍'])
  })

  it('boosts a matching recent above other substring hits (G5)', () => {
    const items = recommendEmojiItems('finger', {
      recents: ['🤞'],
      popularShortcodes: popular,
      lookup,
      catalog,
      max: 12,
    })
    expect(items[0]?.emoji).toBe('🤞')
    expect(items.some((i) => i.name === 'raised_hand_with_fingers_splayed')).toBe(true)
  })

  it('ranks an exact shortcode/name match first (G5)', () => {
    const items = recommendEmojiItems('fingers_crossed', {
      recents: ['🔥'],
      popularShortcodes: popular,
      lookup,
      catalog,
      max: 12,
    })
    expect(items[0]?.name).toBe('crossed_fingers')
  })

  it('includes crossed_fingers in the popular shortcode list (G4)', () => {
    expect(POPULAR_EMOJI_SHORTCODES).toContain('crossed_fingers')
  })
})

describe('recommendEmojiItems — prefix vs substring ranking (G5)', () => {
  /**
   * Query 'art' against a name that STARTS with it, a name that only CONTAINS
   * it (neither at the start nor the end), and a name that ENDS with it. None
   * of the three is recent and none is an exact name/shortcode match, so the
   * only thing separating them is the prefix rule itself.
   */
  it('ranks a name-prefix match before a mid-word or trailing substring match', () => {
    const startsWithQuery: RankableEmoji = {
      name: 'artichoke',
      emoji: '🥬',
      shortcodes: ['artichoke'],
      tags: [],
    }
    const containsQueryInMiddle: RankableEmoji = {
      name: 'heart_eyes',
      emoji: '😍',
      shortcodes: ['heart_eyes'],
      tags: [],
    }
    const endsWithQuery: RankableEmoji = {
      name: 'smart',
      emoji: '🧠',
      shortcodes: ['smart'],
      tags: [],
    }
    const rankedCatalog = [containsQueryInMiddle, endsWithQuery, startsWithQuery]

    const items = recommendEmojiItems('art', {
      recents: [],
      popularShortcodes: [],
      lookup: (code) => rankedCatalog.find((item) => item.shortcodes.includes(code)),
      catalog: rankedCatalog,
      max: 12,
    })

    expect(items.map((item) => item.name)).toEqual(['artichoke', 'heart_eyes', 'smart'])
  })

  it('ranks a shortcode-prefix match the same as a name-prefix match, before a substring-only match', () => {
    const shortcodeStartsWithQuery: RankableEmoji = {
      name: 'painting',
      emoji: '🎨',
      shortcodes: ['artistic_scene'],
      tags: [],
    }
    const containsQueryInMiddle: RankableEmoji = {
      name: 'heart_eyes',
      emoji: '😍',
      shortcodes: ['heart_eyes'],
      tags: [],
    }
    const rankedCatalog = [containsQueryInMiddle, shortcodeStartsWithQuery]

    const items = recommendEmojiItems('art', {
      recents: [],
      popularShortcodes: [],
      lookup: (code) => rankedCatalog.find((item) => item.shortcodes.includes(code)),
      catalog: rankedCatalog,
      max: 12,
    })

    expect(items.map((item) => item.name)).toEqual(['painting', 'heart_eyes'])
  })
})

describe('recommendEmojiItems — what puts an entry in a rank class (G5)', () => {
  const rank = (catalog: RankableEmoji[], query: string, recents: string[]) =>
    recommendEmojiItems(query, {
      recents,
      popularShortcodes: [],
      lookup: (code) => catalog.find((item) => item.shortcodes.includes(code)),
      catalog,
      max: 12,
    }).map((item) => item.name)

  it('being remembered outranks starting with the query (G5)', () => {
    // Neither entry is an exact match, so the recency class is the only thing
    // that can put the substring hit in front of the prefix hit. Without it
    // the substring hit falls to the bottom class and the order flips.
    const rememberedSubstringHit: RankableEmoji = {
      name: 'red_apple',
      emoji: '\u{1F34E}',
      shortcodes: ['red_apple'],
      tags: [],
    }
    const forgottenPrefixHit: RankableEmoji = {
      name: 'apple_pie',
      emoji: '\u{1F967}',
      shortcodes: ['apple_pie'],
      tags: [],
    }

    expect(rank([forgottenPrefixHit, rememberedSubstringHit], 'apple', ['\u{1F34E}'])).toEqual([
      'red_apple',
      'apple_pie',
    ])
  })

  it('one shortcode that starts with the query is enough, even beside shortcodes that do not (G5)', () => {
    // 'dessert' does not start with 'apple' and 'apple_pie' does. One hit
    // makes the entry a prefix match; requiring all of them would drop it
    // into the bottom class beside the substring-only hit.
    const oneOfTwoShortcodesMatches: RankableEmoji = {
      name: 'pie_of_apples',
      emoji: '\u{1F967}',
      shortcodes: ['dessert', 'apple_pie'],
      tags: [],
    }
    const substringHitOnly: RankableEmoji = {
      name: 'red_apple',
      emoji: '\u{1F34E}',
      shortcodes: ['red_apple'],
      tags: [],
    }

    expect(rank([substringHitOnly, oneOfTwoShortcodesMatches], 'apple', [])).toEqual([
      'pie_of_apples',
      'red_apple',
    ])
  })
})

describe('readRecentEmojis — storage that refuses to answer', () => {
  afterEach(() => {
    // Put the working in-memory storage back for every later test in the file.
    installInMemoryLocalStorage()
    window.localStorage.clear()
  })

  /**
   * `vi.spyOn(Storage.prototype, …)` cannot reach this: the in-memory stand-in
   * installed at the top of this file is a plain object, not a `Storage`
   * instance, and happy-dom's own storage is not backed by the prototype
   * either. Redefining the property is the only seam.
   */
  function replaceLocalStorage(descriptor: PropertyDescriptor): void {
    Object.defineProperty(window, 'localStorage', { configurable: true, ...descriptor })
  }

  it('reads as "nothing remembered" when touching localStorage itself throws (G3)', () => {
    replaceLocalStorage({
      get() {
        // What a privacy-restricted embedded widget does on property access.
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })

    expect(readRecentEmojis()).toEqual([])
  })

  it('reads as "nothing remembered" when getItem throws (G3)', () => {
    replaceLocalStorage({
      value: {
        getItem: () => {
          throw new DOMException('Access is denied for this document.', 'SecurityError')
        },
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      } as unknown as Storage,
      writable: true,
    })

    expect(readRecentEmojis()).toEqual([])
  })

  it('a write into storage that refuses it is not an error (G3)', () => {
    replaceLocalStorage({
      value: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('Quota exceeded.', 'QuotaExceededError')
        },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      } as unknown as Storage,
      writable: true,
    })

    expect(() => recordRecentEmoji('🎉')).not.toThrow()
  })

  it('reads as "nothing remembered" where there is no window at all (G3)', () => {
    // The server render of a composer: the module is imported, nothing is
    // stored, and reading must answer rather than reach for a browser global.
    vi.stubGlobal('window', undefined)
    try {
      expect(readRecentEmojis()).toEqual([])
      expect(() => recordRecentEmoji('🎉')).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('drops stored entries that are not non-empty strings (G3)', () => {
    installInMemoryLocalStorage()
    window.localStorage.setItem(
      'quackback:emoji-recent',
      JSON.stringify(['🎉', '', 7, null, { emoji: '🔥' }, '🤞'])
    )

    expect(readRecentEmojis()).toEqual(['🎉', '🤞'])
  })

  it('reads a stored value that is valid JSON but not a list as nothing (G3)', () => {
    installInMemoryLocalStorage()
    window.localStorage.setItem('quackback:emoji-recent', JSON.stringify({ '🎉': 1 }))

    expect(readRecentEmojis()).toEqual([])
  })
})

/**
 * The remembered list as a sequence of recordings against a hand-written oracle.
 *
 * The generator draws from a small alphabet of real glyphs so repeats are
 * frequent (that is what makes the dedupe branch fire) and mixes in the blank
 * and whitespace-only glyphs the contract says must not be remembered. Runs are
 * long enough to pass MAX_RECENT_EMOJIS several times over, so the cap and the
 * eviction of the oldest entry are reached rather than assumed.
 */
describe('recordRecentEmoji — properties', () => {
  const GLYPHS = ['🎉', '🤞', '🔥', '😄', '👍', '❤️', '🚀', '🌮', '🎊', '🙏'] as const
  const BLANKS = ['', ' ', '   ', '\t', '\n'] as const
  const recordable = fc.constantFrom(...GLYPHS, ...BLANKS)

  /** The contract in one function: front, deduped, capped, blanks ignored. */
  function expectedRecents(recorded: readonly string[]): string[] {
    let remembered: string[] = []
    for (const raw of recorded) {
      const glyph = raw.trim()
      if (!glyph) continue
      remembered = [glyph, ...remembered.filter((item) => item !== glyph)].slice(
        0,
        MAX_RECENT_EMOJIS
      )
    }
    return remembered
  }

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('remembers most-recent-first, without duplicates, at most eight (G3)', () => {
    fc.assert(
      fc.property(fc.array(recordable, { minLength: 1, maxLength: 40 }), (recorded) => {
        window.localStorage.clear()
        for (const glyph of recorded) recordRecentEmoji(glyph)

        const remembered = readRecentEmojis()
        expect(remembered).toEqual(expectedRecents(recorded))
        expect(remembered.length).toBeLessThanOrEqual(MAX_RECENT_EMOJIS)
        expect(new Set(remembered).size).toBe(remembered.length)
        expect(remembered).not.toContain('')
      })
    )
  })

  it('recording a glyph again only moves it, it never adds an entry (G3)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...GLYPHS), { minLength: 1, maxLength: 12 }),
        (recorded) => {
          window.localStorage.clear()
          for (const glyph of recorded) recordRecentEmoji(glyph)
          const before = readRecentEmojis()

          recordRecentEmoji(before[before.length - 1]!)
          const after = readRecentEmojis()

          expect(after.length).toBe(before.length)
          expect(new Set(after)).toEqual(new Set(before))
          expect(after[0]).toBe(before[before.length - 1])
        }
      )
    )
  })
})

/**
 * Ranking over a generated catalogue.
 *
 * The item generator is structured rather than random: names and shortcodes are
 * drawn from a small vocabulary so a generated query really hits, and the glyph
 * is optional so the "only emoji that have a glyph" half of E5 is exercised
 * instead of assumed. Between them the generators reach every state the ranking
 * distinguishes — an exact name match ('tada'), an exact shortcode match ('ok'),
 * a remembered glyph, a prefix match ('ta', 'fi'), a substring match ('a' inside
 * 'tada'), a tag-only match ('party'), a query that matches nothing ('zzz'),
 * items with no glyph, and two catalogue entries carrying the same name (the
 * query path does not dedupe, so both survive and have to be ordered).
 *
 * The oracles below are read off E4/E5's own wording — "an exact name or
 * shortcode match first, then remembered emoji in recency order, then prefix
 * matches, then the rest" — not off the implementation.
 */
describe('recommendEmojiItems — properties', () => {
  const GLYPHS = ['🎉', '🌮', '🔥', '🎊', '😄', '❤️', '🤞', '👍'] as const
  const WORDS = ['tada', 'taco', 'fire', 'fiesta', 'smile', 'heart', 'ok', 'ok_hand'] as const
  const TAGS = ['party', 'hot', 'food', 'face', 'luck'] as const

  const generatedItem = fc.record({
    name: fc.constantFrom(...WORDS),
    shortcodes: fc.uniqueArray(fc.constantFrom(...WORDS, 'ta', 'ok'), {
      minLength: 1,
      maxLength: 2,
    }),
    emoji: fc.option(fc.constantFrom(...GLYPHS), { nil: undefined }),
    tags: fc.array(fc.constantFrom(...TAGS), { maxLength: 2 }),
  }) satisfies fc.Arbitrary<RankableEmoji>

  const generatedCatalog = fc.array(generatedItem, { minLength: 1, maxLength: 12 })
  const generatedRecents = fc.uniqueArray(fc.constantFrom(...GLYPHS), { maxLength: 5 })
  const QUERIES = ['tada', 'ok', 'ta', 'fi', 'a', 'party', 'heart', 'zzz', 'ok_hand'] as const
  const typedQuery = fc.constantFrom(...QUERIES)
  const generatedMax = fc.integer({ min: 1, max: 12 })

  function normalize(query: string): string {
    return query.trim().toLowerCase()
  }

  /** "only emoji whose name, shortcode or tag contains the query". */
  function containsQuery(item: RankableEmoji, query: string): boolean {
    const q = normalize(query)
    return (
      item.name.toLowerCase().includes(q) ||
      item.shortcodes.some((code) => code.toLowerCase().includes(q)) ||
      (item.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
    )
  }

  /** "an exact … match first, then remembered …, then prefix matches, then the rest". */
  function rankFromContract(
    item: RankableEmoji,
    query: string,
    recents: readonly string[]
  ): number {
    const q = normalize(query)
    const name = item.name.toLowerCase()
    const shorts = item.shortcodes.map((code) => code.toLowerCase())
    if (name === q || shorts.includes(q)) return 0
    if (item.emoji && recents.includes(item.emoji)) return 1
    if (name.startsWith(q) || shorts.some((code) => code.startsWith(q))) return 2
    return 3
  }

  /** "in recency order" — a glyph nobody remembers sorts after every one they do. */
  function recencyKey(item: RankableEmoji, recents: readonly string[]): number {
    const at = item.emoji ? recents.indexOf(item.emoji) : -1
    return at === -1 ? Number.POSITIVE_INFINITY : at
  }

  const lookupIn = (catalog: readonly RankableEmoji[]) => (shortcode: string) =>
    catalog.find((item) => item.name === shortcode || item.shortcodes.includes(shortcode))

  it('suggests only glyph-carrying emoji that contain the query, capped (G5)', () => {
    fc.assert(
      fc.property(
        generatedCatalog,
        generatedRecents,
        typedQuery,
        generatedMax,
        (catalog, recents, query, max) => {
          const items = recommendEmojiItems(query, {
            recents,
            popularShortcodes: WORDS,
            lookup: lookupIn(catalog),
            catalog,
            max,
          })

          expect(items.length).toBeLessThanOrEqual(max)
          for (const item of items) {
            expect(item.emoji).toBeTruthy()
            expect(containsQuery(item, query)).toBe(true)
          }
        }
      )
    )
  })

  it('leaves out no match that fits inside the cap (G5)', () => {
    fc.assert(
      fc.property(generatedCatalog, generatedRecents, typedQuery, (catalog, recents, query) => {
        const eligible = catalog.filter((item) => item.emoji && containsQuery(item, query))
        const items = recommendEmojiItems(query, {
          recents,
          popularShortcodes: WORDS,
          lookup: lookupIn(catalog),
          catalog,
          max: catalog.length + 1,
        })

        expect(items.length).toBe(eligible.length)
        expect(new Set(items)).toEqual(new Set(eligible))
      })
    )
  })

  it('orders exact, then remembered by recency, then prefix, then the rest (G5)', () => {
    fc.assert(
      fc.property(
        generatedCatalog,
        generatedRecents,
        typedQuery,
        generatedMax,
        (catalog, recents, query, max) => {
          const items = recommendEmojiItems(query, {
            recents,
            popularShortcodes: WORDS,
            lookup: lookupIn(catalog),
            catalog,
            max,
          })

          for (let i = 1; i < items.length; i++) {
            const before = items[i - 1]!
            const after = items[i]!
            const rankBefore = rankFromContract(before, query, recents)
            const rankAfter = rankFromContract(after, query, recents)
            expect(rankBefore).toBeLessThanOrEqual(rankAfter)
            if (rankBefore === rankAfter) {
              expect(recencyKey(before, recents)).toBeLessThanOrEqual(recencyKey(after, recents))
            }
          }
        }
      )
    )
  })

  it('the case and the surrounding whitespace of a query change nothing (G6)', () => {
    const spellings = (query: string) => [
      query,
      query.toUpperCase(),
      `  ${query}`,
      `${query}\t`,
      `\n  ${query.toUpperCase()}  `,
    ]

    fc.assert(
      fc.property(
        generatedCatalog,
        generatedRecents,
        fc.constantFrom(...QUERIES, ''),
        generatedMax,
        (catalog, recents, query, max) => {
          const run = (spelling: string) =>
            recommendEmojiItems(spelling, {
              recents,
              popularShortcodes: WORDS,
              lookup: lookupIn(catalog),
              catalog,
              max,
            })

          const baseline = run(query)
          for (const spelling of spellings(query)) {
            expect(run(spelling)).toEqual(baseline)
          }
        }
      )
    )
  })

  it('on a bare colon lists remembered glyphs first, then popular, each once (G4)', () => {
    fc.assert(
      fc.property(
        generatedCatalog,
        generatedRecents,
        generatedMax,
        fc.constantFrom('', '   ', '\t\n'),
        (catalog, recents, max, blankQuery) => {
          const lookup = lookupIn(catalog)
          const items = recommendEmojiItems(blankQuery, {
            recents,
            popularShortcodes: WORDS,
            lookup,
            catalog,
            max,
          })

          const expected: RankableEmoji[] = []
          const push = (candidate: RankableEmoji | undefined) => {
            if (!candidate?.emoji) return
            if (expected.some((existing) => existing.name === candidate.name)) return
            expected.push(candidate)
          }
          for (const glyph of recents) {
            push(catalog.find((item) => item.emoji === glyph))
          }
          for (const shortcode of WORDS) push(lookup(shortcode))

          expect(items).toEqual(expected.slice(0, max))
          expect(items.length).toBeLessThanOrEqual(max)
          expect(new Set(items.map((item) => item.name)).size).toBe(items.length)
          for (const item of items) expect(item.emoji).toBeTruthy()
        }
      )
    )
  })
})

/**
 * The recency tie-break inside one rank class, spelled out.
 *
 * Two items can share a rank in three ways and the comparator answers each
 * differently: both remembered (older one later), exactly one remembered (that
 * one first), neither remembered (catalogue order kept). Only the exact-match
 * class can hold a remembered and a not-remembered item at once — a remembered
 * emoji that is not an exact match already outranks a prefix hit — so the
 * one-sided cases are built from two entries that both match `ok` exactly.
 */
describe('recommendEmojiItems — recency inside one rank class', () => {
  const ok: RankableEmoji = { name: 'ok', emoji: '🆗', shortcodes: ['ok'], tags: [] }
  const okHand: RankableEmoji = { name: 'ok_hand', emoji: '👌', shortcodes: ['ok'], tags: [] }
  const fire: RankableEmoji = { name: 'fire', emoji: '🔥', shortcodes: ['fire'], tags: [] }
  const fiesta: RankableEmoji = { name: 'fiesta', emoji: '🎊', shortcodes: ['fiesta'], tags: [] }

  const rank = (catalog: RankableEmoji[], query: string, recents: string[]) =>
    recommendEmojiItems(query, {
      recents,
      popularShortcodes: [],
      lookup: (code) => catalog.find((item) => item.shortcodes.includes(code)),
      catalog,
      max: 12,
    }).map((item) => item.name)

  it('a remembered exact match comes before an exact match nobody used (G5)', () => {
    expect(rank([ok, okHand], 'ok', ['👌'])).toEqual(['ok_hand', 'ok'])
  })

  it('and the same holds when the catalogue lists them the other way round (G5)', () => {
    expect(rank([okHand, ok], 'ok', ['🆗'])).toEqual(['ok', 'ok_hand'])
  })

  it('a remembered exact match wins even when it is not the most recently used glyph (G5)', () => {
    // The remembered glyph sits at recency position 1, behind an emoji that
    // does not match this query at all. Position 0 and position 1 have to
    // count the same against an entry nobody remembers: what separates these
    // two is "remembered or not", not "remembered first".
    expect(rank([ok, okHand], 'ok', ['\u{1F525}', '\u{1F44C}'])).toEqual(['ok_hand', 'ok'])
  })

  it('two remembered matches keep their recency order, newest first (G5)', () => {
    expect(rank([fire, fiesta], 'fi', ['🎊', '🔥'])).toEqual(['fiesta', 'fire'])
    expect(rank([fire, fiesta], 'fi', ['🔥', '🎊'])).toEqual(['fire', 'fiesta'])
  })

  it('two matches nobody remembers keep the catalogue order (G5)', () => {
    expect(rank([fire, fiesta], 'fi', [])).toEqual(['fire', 'fiesta'])
    expect(rank([fiesta, fire], 'fi', [])).toEqual(['fiesta', 'fire'])
  })

  it('an emoji that carries no tags at all is still matched by name (G5)', () => {
    const untagged: RankableEmoji = { name: 'fireworks', emoji: '🎆', shortcodes: ['fireworks'] }
    expect(rank([untagged], 'fire', [])).toEqual(['fireworks'])
    expect(rank([untagged], 'party', [])).toEqual([])
  })

  const apple1: RankableEmoji = {
    name: 'apple_one',
    emoji: '🍎',
    shortcodes: ['apple_one'],
    tags: [],
  }
  const apple2: RankableEmoji = {
    name: 'apple_two',
    emoji: '🍏',
    shortcodes: ['apple_two'],
    tags: [],
  }
  const apple3: RankableEmoji = {
    name: 'apple_three',
    emoji: '🍐',
    shortcodes: ['apple_three'],
    tags: [],
  }

  it('three remembered matches sort strictly by recency, with the catalogue in the opposite order (G5)', () => {
    // Catalogue order is apple1, apple2, apple3; recency is the exact reverse
    // of it, so a result that merely kept catalogue order would be wrong too.
    expect(rank([apple1, apple2, apple3], 'apple', ['🍐', '🍏', '🍎'])).toEqual([
      'apple_three',
      'apple_two',
      'apple_one',
    ])
  })

  it('with nobody remembered, three same-rank matches keep the catalogue order either way round (G5)', () => {
    expect(rank([apple1, apple2, apple3], 'apple', [])).toEqual([
      'apple_one',
      'apple_two',
      'apple_three',
    ])
    expect(rank([apple3, apple2, apple1], 'apple', [])).toEqual([
      'apple_three',
      'apple_two',
      'apple_one',
    ])
  })

  /** Every ordering of a fixed 4-item list, smallest-first (Heap's algorithm). */
  function permutationsOf<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [items.slice()]
    const result: T[][] = []
    for (let pivot = 0; pivot < items.length; pivot++) {
      const rest = [...items.slice(0, pivot), ...items.slice(pivot + 1)]
      for (const tail of permutationsOf(rest)) {
        result.push([items[pivot]!, ...tail])
      }
    }
    return result
  }

  it('for every catalogue ordering, recent items lead by recency and the rest keep their relative catalogue order (G5)', () => {
    // Two recent items (a strict recency order between them, no tie) and two
    // that are never recent (so only catalogue order can separate them).
    // Trying every arrangement of the four means the pairwise comparator gets
    // called with both items in both parameter positions across the run, so
    // neither side of the recency check can go unexercised.
    const recentNewer: RankableEmoji = {
      name: 'apple_newer',
      emoji: '🍎',
      shortcodes: ['apple_newer'],
      tags: [],
    }
    const recentOlder: RankableEmoji = {
      name: 'apple_older',
      emoji: '🍏',
      shortcodes: ['apple_older'],
      tags: [],
    }
    const neverRecentOne: RankableEmoji = {
      name: 'apple_plain_one',
      emoji: '🍐',
      shortcodes: ['apple_plain_one'],
      tags: [],
    }
    const neverRecentTwo: RankableEmoji = {
      name: 'apple_plain_two',
      emoji: '🍊',
      shortcodes: ['apple_plain_two'],
      tags: [],
    }
    const recents = ['🍎', '🍏']

    for (const catalog of permutationsOf([
      recentNewer,
      recentOlder,
      neverRecentOne,
      neverRecentTwo,
    ])) {
      const plainNamesInCatalogOrder = catalog
        .filter((item) => item === neverRecentOne || item === neverRecentTwo)
        .map((item) => item.name)

      expect(rank(catalog, 'apple', recents)).toEqual([
        'apple_newer',
        'apple_older',
        ...plainNamesInCatalogOrder,
      ])
    }
  })
})
