// @vitest-environment happy-dom
/**
 * The public changelog page's product filter, at the route level.
 *
 * V9  The filter survives sharing: the chosen products are part of the page
 *     address, and opening that address reproduces the same list.
 * V11 The RSS feed filters by the same products under the same rules as the
 *     page.
 *
 * The address is the whole mechanism here, so this file is about the address:
 * that the route accepts `board`, that what it accepts reaches the list, and
 * that the RSS link beside the heading carries the reader's current selection
 * rather than silently widening back to every product.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const search = vi.hoisted(() => ({ current: {} as { board?: string[] } }))
const listProps = vi.hoisted(() => ({ current: null as { boardIds?: string[] } | null }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({
      ...options,
      useRouteContext: () => ({ session: null }),
      useSearch: () => search.current,
    }),
  notFound: () => new Error('not found'),
}))
vi.mock('@/components/portal/changelog', () => ({
  ChangelogListPublic: (props: { boardIds?: string[] }) => {
    listProps.current = props
    return <div data-testid="changelog-list" />
  },
  ChangelogSubscribeButton: () => null,
}))
vi.mock('@/lib/server/functions/public-cache', () => ({
  setPublicDocumentCacheHeaders: vi.fn(),
}))

import { Route } from '../changelog.index'

const Page = (Route as unknown as { component: React.ComponentType }).component
const validateSearch = (Route as unknown as { validateSearch: { parse: (v: unknown) => unknown } })
  .validateSearch

function renderPage(board?: string[]) {
  search.current = board ? { board } : {}
  render(
    <IntlProvider locale="en" messages={{}}>
      <Page />
    </IntlProvider>
  )
}

/** The RSS link beside the heading. */
function feedHref(): string {
  return screen.getByRole('link', { name: /rss/i }).getAttribute('href')!
}

beforeEach(() => {
  listProps.current = null
})
afterEach(cleanup)

describe('changelog page address', () => {
  it('accepts a product in the address (V9)', () => {
    expect(validateSearch.parse({ board: ['board_alpha'] })).toEqual({ board: ['board_alpha'] })
  })

  it('accepts several products, and an address with none at all (V9)', () => {
    expect(validateSearch.parse({ board: ['board_alpha', 'board_beta'] })).toEqual({
      board: ['board_alpha', 'board_beta'],
    })
    expect(validateSearch.parse({})).toEqual({})
  })

  it('hands the address straight to the list rather than filtering after the fact (V9)', () => {
    renderPage(['board_alpha'])
    expect(listProps.current?.boardIds).toEqual(['board_alpha'])
  })

  it('leaves the list unnarrowed when the address names no product (V9)', () => {
    renderPage()
    expect(listProps.current?.boardIds).toBeUndefined()
  })

  it('points the RSS link at the product the reader is looking at (V11)', () => {
    renderPage(['board_alpha'])
    expect(feedHref()).toBe('/changelog/feed?board=board_alpha')
  })

  it('carries every selected product into the RSS link (V11)', () => {
    renderPage(['board_alpha', 'board_beta'])
    expect(feedHref()).toBe('/changelog/feed?board=board_alpha&board=board_beta')
  })

  it('escapes a product id rather than letting it break out of the query string (V11)', () => {
    // The id comes out of the address, which anyone can write.
    renderPage(['a&b=c'])
    expect(feedHref()).toBe('/changelog/feed?board=a%26b%3Dc')
  })

  it('offers the plain feed when no product is selected (V11)', () => {
    renderPage()
    expect(feedHref()).toBe('/changelog/feed')
  })
})
