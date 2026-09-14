/**
 * Contract group W — Widget `open()` deep-links (upstream #531)
 *
 * W1 A host `open()` command lands on the documented view: `new-post` expands the composer with the given title, body and board; `post` opens that post; `article` opens the article named by TypeID or slug; `changelog` opens the given entry, or the list without one; `help` opens help with the given query; `messenger`, `tickets`, `messages` and `home` land on their tabs. A view the workspace has not enabled is ignored, and so is an unknown one.
 * W2 A second identical `new-post` command still expands the composer and reapplies title, body and board: the command is the trigger, not its content.
 * W3 A `new-post` board the anonymous visitor could not see is applied once identify makes it visible, but never over a board the visitor picked themselves after the command.
 * W4 Once this session's board list has arrived, a compose board or an SDK `?board=` filter the session cannot see falls back to the default; through the anonymous first paint the choice is kept.
 * W5 Similar-post hits are cached per session and bounded: a later identify or logout never shows a previous visitor's titles, the cache holds at most 40 queries and drops the oldest first, and a failed search shows no hits rather than stale ones.
 * W6 Help search, help categories, article detail, changelog list and detail, Ask AI and the unread badge all carry the widget identity and are keyed by session, so identify or logout refetches them and no placeholder from another identity is shown.
 * W7 When the session changes, help search drops its results, its in-flight request and its cache; a response from an earlier session is discarded; a non-OK response yields no results.
 * W8 "View on portal" on an article or changelog entry carries a one-time token for an identified visitor and none for an anonymous one; the article URL uses the locale the article was resolved in.
 * W9 A help category the new session cannot see is left once the category list has loaded; before it loads nothing happens.
 * W10 A changelog category filter the current feed no longer contains is cleared.
 * W11 Resolving a public article accepts an `article_` id, a retired `kb_article_` id or a slug; it falls back to the default locale when the requested one has no version and reports the locale it resolved to; helpfulness counters are not exposed; an article that does not exist or is not public resolves to nothing.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const auth = { sessionVersion: 0, isIdentified: false }
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: auth.sessionVersion,
    isIdentified: auth.isIdentified,
    hmacRequired: false,
    user: null,
    emitEvent: vi.fn(),
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
  }),
}))

const WIDGET_HEADERS = { Authorization: 'Bearer widget-token' }
const generateOneTimeToken = vi.fn(async () => 'ott-456')
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => WIDGET_HEADERS,
  generateOneTimeToken: () => generateOneTimeToken(),
}))

const sendToHost = vi.fn()
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: (msg: unknown) => sendToHost(msg) }))

const listPublicChangelogsFn = vi.fn()
const getPublicChangelogFn = vi.fn()
const listChangelogCategoriesFn = vi.fn()
vi.mock('@/lib/server/functions/changelog', () => ({
  listPublicChangelogsFn: (...args: unknown[]) => listPublicChangelogsFn(...(args as [])),
  getPublicChangelogFn: (...args: unknown[]) => getPublicChangelogFn(...(args as [])),
  listChangelogsFn: vi.fn(),
  getChangelogFn: vi.fn(),
  topViewedChangelogsFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/changelog-categories', () => ({
  listChangelogCategoriesFn: (...args: unknown[]) => listChangelogCategoriesFn(...(args as [])),
}))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({
  useInfiniteScroll: () => ({ current: null }),
}))
vi.mock('@/components/shared/embed-hydration', () => ({ EmbedHydration: () => null }))

import { WidgetChangelog } from '../widget-changelog'
import { WidgetChangelogDetail } from '../widget-changelog-detail'
import { WidgetChangelogTeaser } from '../widget-changelog-teaser'
import { useChangelogUnread } from '../use-changelog-unread'

const CATEGORY_SHIPPED = { id: 'clcat_shipped', name: 'Shipped', color: '#00aa00' }
const CATEGORY_GATED = { id: 'clcat_gated', name: 'Beta', color: '#aa0000' }

function entry(id: string, title: string, categories: Array<{ id: string; name: string }>) {
  return {
    id,
    title,
    content: 'Body text',
    contentJson: null,
    publishedAt: '2026-09-01T10:00:00Z',
    categories,
    authorName: 'Ada',
    authorAvatarUrl: null,
  }
}

let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  auth.sessionVersion = 0
  auth.isIdentified = false
  sendToHost.mockClear()
  generateOneTimeToken.mockClear()
  listPublicChangelogsFn.mockReset().mockResolvedValue({
    items: [entry('chg_1', 'Shipped dark mode', [CATEGORY_SHIPPED])],
    nextCursor: null,
  })
  getPublicChangelogFn.mockReset().mockResolvedValue(entry('chg_1', 'Shipped dark mode', []))
  listChangelogCategoriesFn.mockReset().mockResolvedValue([CATEGORY_SHIPPED, CATEGORY_GATED])
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  window.localStorage.clear()
})

/** The filter row's pills are the buttons carrying `aria-pressed`; an entry's
 *  own category chip carries the same text and is not a control. */
async function findFilterPill(name: string) {
  const pills = await screen.findAllByRole('button')
  const pill = pills.find((b) => b.hasAttribute('aria-pressed') && b.textContent === name)
  if (!pill) throw new Error(`no filter pill named ${name}`)
  return pill
}

describe('WidgetChangelog', () => {
  it('fetches the feed with the widget identity (W6)', async () => {
    render(<WidgetChangelog teamName="Acme" />, { wrapper })

    await waitFor(() => expect(listPublicChangelogsFn).toHaveBeenCalled())
    expect(listPublicChangelogsFn).toHaveBeenCalledWith({
      data: { cursor: undefined, limit: 10 },
      headers: WIDGET_HEADERS,
    })
    expect(await screen.findByText('Shipped dark mode')).toBeTruthy()
  })

  it('clears a category filter the new session’s feed no longer contains (W10)', async () => {
    auth.sessionVersion = 1
    const first = render(<WidgetChangelog teamName="Acme" />, { wrapper })

    fireEvent.click(await findFilterPill('Shipped'))
    await waitFor(async () =>
      expect((await findFilterPill('Shipped')).getAttribute('aria-pressed')).toBe('true')
    )
    first.unmount()

    // A logout re-keys the feed; the replacement visitor's entries carry no
    // such category, so the restored filter must not survive.
    listPublicChangelogsFn.mockResolvedValue({
      items: [entry('chg_2', 'Public note', [CATEGORY_GATED])],
      nextCursor: null,
    })
    auth.sessionVersion = 2
    render(<WidgetChangelog teamName="Acme" />, { wrapper })

    await waitFor(async () =>
      expect((await findFilterPill('All')).getAttribute('aria-pressed')).toBe('true')
    )
  })

  it('keeps a category filter the feed still contains (W10)', async () => {
    auth.sessionVersion = 1
    render(<WidgetChangelog teamName="Acme" />, { wrapper })

    fireEvent.click(await findFilterPill('Shipped'))

    await waitFor(async () =>
      expect((await findFilterPill('Shipped')).getAttribute('aria-pressed')).toBe('true')
    )
    expect((await findFilterPill('All')).getAttribute('aria-pressed')).toBe('false')
    // Leave the module-level "where the visitor was" state as this suite found it.
    fireEvent.click(await findFilterPill('All'))
  })
})

describe('WidgetChangelogDetail', () => {
  it('fetches the entry with the widget identity, keyed by session (W6)', async () => {
    auth.sessionVersion = 3
    render(<WidgetChangelogDetail entryId="chg_1" />, { wrapper })

    await waitFor(() => expect(getPublicChangelogFn).toHaveBeenCalled())
    expect(getPublicChangelogFn).toHaveBeenCalledWith({
      data: { id: 'chg_1' },
      headers: WIDGET_HEADERS,
    })
    expect(await screen.findByText('Shipped dark mode')).toBeTruthy()
  })

  it('does not show one identity’s entry while the next one loads (W6)', async () => {
    const { rerender } = render(<WidgetChangelogDetail entryId="chg_1" />, { wrapper })
    expect(await screen.findByText('Shipped dark mode')).toBeTruthy()

    getPublicChangelogFn.mockImplementation(() => new Promise(() => {}))
    auth.sessionVersion = 1
    rerender(<WidgetChangelogDetail entryId="chg_1" />)

    await waitFor(() => expect(screen.queryByText('Shipped dark mode')).toBeNull())
  })

  it('carries a one-time token to the portal for an identified visitor (W8)', async () => {
    auth.isIdentified = true
    render(<WidgetChangelogDetail entryId="chg_1" />, { wrapper })
    fireEvent.click(await screen.findByText('Shipped dark mode'))

    await waitFor(() => expect(sendToHost).toHaveBeenCalled())
    const { url } = sendToHost.mock.calls[0][0] as { url: string }
    expect(url).toContain('/changelog/chg_1')
    expect(new URL(url).searchParams.get('ott')).toBe('ott-456')
  })

  it('carries no token to the portal for an anonymous visitor (W8)', async () => {
    render(<WidgetChangelogDetail entryId="chg_1" />, { wrapper })
    fireEvent.click(await screen.findByText('Shipped dark mode'))

    await waitFor(() => expect(sendToHost).toHaveBeenCalled())
    const { url } = sendToHost.mock.calls[0][0] as { url: string }
    expect(new URL(url).searchParams.get('ott')).toBeNull()
    expect(generateOneTimeToken).not.toHaveBeenCalled()
  })
})

describe('WidgetChangelogTeaser', () => {
  it('reads the newest entry from the session-keyed feed (W6)', async () => {
    auth.sessionVersion = 2
    render(<WidgetChangelogTeaser onOpenEntry={vi.fn()} onSeeAll={vi.fn()} />, { wrapper })

    expect(await screen.findByText('Shipped dark mode')).toBeTruthy()
    expect(listPublicChangelogsFn).toHaveBeenCalledWith({
      data: { cursor: undefined, limit: 10 },
      headers: WIDGET_HEADERS,
    })
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey))
    expect(keys).toContain(JSON.stringify(['widget', 'changelogs', 2]))
  })
})

describe('useChangelogUnread', () => {
  it('counts unread entries off the session-keyed feed (W6)', async () => {
    auth.sessionVersion = 6
    // A visitor with a marker from before this entry: it counts as unread.
    window.localStorage.setItem('quackback:changelog-seen-at', '2026-08-01T00:00:00Z')
    const { result } = renderHook(() => useChangelogUnread(true), { wrapper })

    await waitFor(() => expect(listPublicChangelogsFn).toHaveBeenCalled())
    expect(listPublicChangelogsFn).toHaveBeenCalledWith({
      data: { cursor: undefined, limit: 10 },
      headers: WIDGET_HEADERS,
    })
    await waitFor(() => expect(result.current.unread).toBe(1))

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey))
    expect(keys).toContain(JSON.stringify(['widget', 'changelogs', 6]))
  })
})
