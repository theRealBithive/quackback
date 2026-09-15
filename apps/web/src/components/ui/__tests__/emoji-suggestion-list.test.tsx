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

import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { screen, act, cleanup, createEvent, fireEvent } from '@testing-library/react'
import { renderWithIntl } from '@/test/render-with-intl'
import { EmojiSuggestionList } from '../rich-text-editor'
import type { EmojiItem } from '@/lib/shared/content-emoji'

const items: EmojiItem[] = [
  {
    name: 'crossed_fingers',
    emoji: '🤞',
    shortcodes: ['fingers_crossed'],
    tags: ['finger'],
  },
  {
    name: 'tada',
    emoji: '🎉',
    shortcodes: ['tada'],
    tags: ['party'],
  },
  {
    name: 'fire',
    emoji: '🔥',
    shortcodes: ['fire'],
    tags: ['hot'],
  },
]

type ListHandle = { onKeyDown: (p: { event: KeyboardEvent }) => boolean }

function fireKey(ref: React.RefObject<ListHandle | null>, key: string): boolean {
  let result = false
  act(() => {
    result = ref.current!.onKeyDown({ event: new KeyboardEvent('keydown', { key }) })
  })
  return result
}

describe('EmojiSuggestionList', () => {
  it('Tab selects the highlighted row (Slack-style) (G1)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    renderWithIntl(<EmojiSuggestionList ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'Tab')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[0])
  })

  it('Home/End jump to first/last row (G1)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    renderWithIntl(<EmojiSuggestionList ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'End')).toBe(true)
    expect(fireKey(ref, 'Enter')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[2])
    command.mockClear()
    expect(fireKey(ref, 'Home')).toBe(true)
    expect(fireKey(ref, 'Enter')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[0])
  })

  it('renders shortcodes so the highlighted suggestion is visible (G8)', () => {
    const { container } = renderWithIntl(<EmojiSuggestionList items={items} command={() => {}} />)
    expect(container.querySelector('[data-emoji-shortcode="fingers_crossed"]')).not.toBeNull()
    expect(container.querySelector('[data-emoji-shortcode="tada"]')).not.toBeNull()
  })

  it('highlights the typed query in the Slack name (:crossed_fingers:) (G7)', () => {
    const { container } = renderWithIntl(
      <EmojiSuggestionList items={items} command={() => {}} query="fingers" />
    )
    expect(container.querySelector('[data-emoji-shortcode="crossed_fingers"]')).not.toBeNull()
    const marks = screen.getAllByText('fingers')
    expect(marks[0]).toHaveAttribute('data-query-match')
    expect(marks[0]).toHaveClass('text-amber-600')
  })

  it('labels Recent then Popular when recentCount is set (bare `:` ) (G12)', () => {
    renderWithIntl(<EmojiSuggestionList items={items} command={() => {}} recentCount={1} />)
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('Popular')).toBeInTheDocument()
  })
})

describe('EmojiSuggestionList — choosing a row with the mouse', () => {
  afterEach(cleanup)

  function rowFor(container: HTMLElement, shortcode: string): HTMLButtonElement {
    const label = container.querySelector(`[data-emoji-shortcode="${shortcode}"]`)
    const button = label?.closest('button')
    if (!button) throw new Error(`no row for ${shortcode}`)
    return button as HTMLButtonElement
  }

  it('a click runs that row’s command exactly once (G11)', () => {
    const command = vi.fn()
    const { container } = renderWithIntl(<EmojiSuggestionList items={items} command={command} />)

    fireEvent.click(rowFor(container, 'tada'))

    expect(command).toHaveBeenCalledOnce()
    expect(command).toHaveBeenCalledWith(items[1])
  })

  it('a click on a row the keyboard never highlighted still picks that row (G11)', () => {
    const command = vi.fn()
    const { container } = renderWithIntl(<EmojiSuggestionList items={items} command={command} />)

    fireEvent.click(rowFor(container, 'fire'))

    expect(command).toHaveBeenCalledOnce()
    expect(command).toHaveBeenCalledWith(items[2])
  })

  it('pressing the mouse down on a row does not move the caret out of the editor (G11)', () => {
    const { container } = renderWithIntl(<EmojiSuggestionList items={items} command={() => {}} />)
    const row = rowFor(container, 'tada')

    const mouseDown = createEvent.mouseDown(row)
    fireEvent(row, mouseDown)

    // Default-prevented, so the editor keeps focus and the suggestion range
    // survives long enough for the click to insert into it.
    expect(mouseDown.defaultPrevented).toBe(true)
  })
})

describe('EmojiSuggestionList — an empty list', () => {
  afterEach(cleanup)

  it('renders nothing and takes no key (G2)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    const { container } = renderWithIntl(
      <EmojiSuggestionList ref={ref} items={[]} command={command} />
    )

    expect(container.querySelector('[data-emoji-picker]')).toBeNull()
    for (const key of ['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(fireKey(ref, key)).toBe(false)
    }
    expect(command).not.toHaveBeenCalled()
  })
})

describe('EmojiSuggestionList — the Recent heading', () => {
  afterEach(cleanup)

  it('names only the leading remembered rows, and the rest Popular (G12)', () => {
    const { container } = renderWithIntl(
      <EmojiSuggestionList items={items} command={() => {}} recentCount={2} />
    )

    const headings = Array.from(container.querySelectorAll('div > div.px-2'))
      .map((node) => node.textContent)
      .filter((text): text is string => Boolean(text))
    expect(headings).toEqual(['Recent', 'Popular'])

    // "Popular" sits in front of the third row, i.e. after the two remembered ones.
    const popular = screen.getByText('Popular')
    expect(popular.parentElement?.querySelector('[data-emoji-shortcode]')).toHaveAttribute(
      'data-emoji-shortcode',
      'fire'
    )
  })

  it('labels nothing recent once something has been typed (G12)', () => {
    renderWithIntl(<EmojiSuggestionList items={items} command={() => {}} query="fingers" />)

    expect(screen.queryByText('Recent')).toBeNull()
    expect(screen.queryByText('Popular')).toBeNull()
  })

  it('labels nothing recent when the remembered run is empty (G12)', () => {
    renderWithIntl(<EmojiSuggestionList items={items} command={() => {}} recentCount={0} />)

    expect(screen.queryByText('Recent')).toBeNull()
    expect(screen.queryByText('Popular')).toBeNull()
  })
})
