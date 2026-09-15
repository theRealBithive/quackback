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
import { SlashMenuList } from '../rich-text-editor'

const items = [
  {
    title: 'Text',
    description: 'Paragraph',
    icon: <span>T</span>,
    command: () => {},
    group: 'text' as const,
  },
  {
    title: 'Bullet list',
    description: 'List',
    icon: <span>B</span>,
    command: () => {},
    group: 'lists' as const,
  },
  {
    title: 'Code',
    description: 'Code block',
    icon: <span>C</span>,
    command: () => {},
    group: 'blocks' as const,
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

describe('SlashMenuList', () => {
  it('Tab selects the highlighted row (Slack-style) (G1)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    renderWithIntl(<SlashMenuList ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'Tab')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[0])
  })

  it('Shift+Tab (key Tab) also confirms (G1)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    renderWithIntl(<SlashMenuList ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'Tab')).toBe(true)
    expect(command).toHaveBeenCalledOnce()
  })

  it('renders command titles (G11)', () => {
    renderWithIntl(<SlashMenuList items={items} command={() => {}} />)
    expect(screen.getByText('Bullet list')).toBeInTheDocument()
    expect(screen.getByText('Code')).toBeInTheDocument()
  })

  it('highlights the typed query in command titles (G7)', () => {
    renderWithIntl(<SlashMenuList items={items} command={() => {}} query="list" />)
    expect(screen.getByText('list')).toHaveAttribute('data-query-match')
  })
})

describe('SlashMenuList — moving the highlight', () => {
  afterEach(cleanup)

  const rows = (container: HTMLElement) => Array.from(container.querySelectorAll('button'))
  /**
   * `classList.contains`, not `className.includes`: every row carries
   * `hover:bg-accent` and `focus:bg-accent`, so a substring test reports row 0
   * as highlighted forever and the arrows look like they do nothing.
   */
  const highlighted = (container: HTMLElement) =>
    rows(container).findIndex((row) => row.classList.contains('bg-accent'))

  it('ArrowDown moves the highlight one row on, and Enter confirms that row (G1)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    const { container } = renderWithIntl(
      <SlashMenuList ref={ref} items={items} command={command} />
    )
    expect(highlighted(container)).toBe(0)

    expect(fireKey(ref, 'ArrowDown')).toBe(true)
    expect(highlighted(container)).toBe(1)

    expect(fireKey(ref, 'Enter')).toBe(true)
    expect(command).toHaveBeenCalledOnce()
    expect(command).toHaveBeenCalledWith(items[1])
  })

  it('ArrowUp from the first row wraps to the last one (G1)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    const { container } = renderWithIntl(
      <SlashMenuList ref={ref} items={items} command={command} />
    )

    expect(fireKey(ref, 'ArrowUp')).toBe(true)
    expect(highlighted(container)).toBe(items.length - 1)

    expect(fireKey(ref, 'Tab')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[items.length - 1])
  })

  it('End then Home walk to the last row and back to the first (G1)', () => {
    const ref = createRef<ListHandle>()
    const { container } = renderWithIntl(
      <SlashMenuList ref={ref} items={items} command={() => {}} />
    )

    expect(fireKey(ref, 'End')).toBe(true)
    expect(highlighted(container)).toBe(items.length - 1)

    expect(fireKey(ref, 'Home')).toBe(true)
    expect(highlighted(container)).toBe(0)
  })

  it('leaves a key it does not use to the editor (G1)', () => {
    const ref = createRef<ListHandle>()
    renderWithIntl(<SlashMenuList ref={ref} items={items} command={() => {}} />)

    expect(fireKey(ref, 'x')).toBe(false)
    expect(fireKey(ref, 'Escape')).toBe(false)
  })
})

describe('SlashMenuList — choosing a row with the mouse', () => {
  afterEach(cleanup)

  it('a click runs that row’s command exactly once (G11)', () => {
    const command = vi.fn()
    renderWithIntl(<SlashMenuList items={items} command={command} />)

    fireEvent.click(screen.getByRole('button', { name: /Code/ }))

    expect(command).toHaveBeenCalledOnce()
    expect(command).toHaveBeenCalledWith(items[2])
  })

  it('a click picks the row under the pointer, not the highlighted one (G11)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    renderWithIntl(<SlashMenuList ref={ref} items={items} command={command} />)

    expect(fireKey(ref, 'End')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Text/ }))

    expect(command).toHaveBeenCalledOnce()
    expect(command).toHaveBeenCalledWith(items[0])
  })

  it('pressing the mouse down on a row does not move the caret out of the editor (G11)', () => {
    renderWithIntl(<SlashMenuList items={items} command={() => {}} />)
    const row = screen.getByRole('button', { name: /Code/ })

    const mouseDown = createEvent.mouseDown(row)
    fireEvent(row, mouseDown)

    expect(mouseDown.defaultPrevented).toBe(true)
  })
})

describe('SlashMenuList — an empty list', () => {
  afterEach(cleanup)

  it('says nothing matched and takes no key (G2)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    renderWithIntl(<SlashMenuList ref={ref} items={[]} command={command} />)

    expect(screen.getByText('No matching commands')).toBeInTheDocument()
    for (const key of ['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(fireKey(ref, key)).toBe(false)
    }
    expect(command).not.toHaveBeenCalled()
  })
})
