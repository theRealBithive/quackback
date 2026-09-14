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
import { act, render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

// The route file imports nothing else from the router, so a stand-in `Route`
// carrying the loader data and search params is the whole mount. Mounting the
// real route would pull the root's onboarding redirect and the generated
// route tree in with it (SELF-IMPROVE: "Mounting a real route in a test").
const loaderData: Record<string, unknown> = {}
const searchData: Record<string, unknown> = {}
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => loaderData,
    useSearch: () => searchData,
  }),
}))

const auth = { sessionVersion: 0 }
vi.mock('@/components/widget/widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    ensureSession: vi.fn(),
    sessionVersion: auth.sessionVersion,
    isIdentified: false,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))

const fetchBoardCapabilitiesFn = vi.fn(async () => ({
  permissions: {} as Record<string, unknown>,
  boards: [] as Array<{ id: string; name: string; slug: string }>,
}))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchBoardCapabilitiesFn: (...args: unknown[]) => fetchBoardCapabilitiesFn(...(args as [])),
}))
vi.mock('@/lib/server/functions/powered-by', () => ({ getShowPoweredByFn: vi.fn() }))
vi.mock('@/lib/server/functions/help-center', () => ({ listPublicArticlesFn: vi.fn() }))
vi.mock('@/components/widget/use-messenger-presence', () => ({
  CONVERSATION_PRESENCE_QUERY_KEY: ['presence'],
  useConversationPresence: () => ({ agentsOnline: 0, withinOfficeHours: true, nextOpenAt: null }),
}))
const ticketBadge = { hasTickets: null as boolean | null }
vi.mock('@/components/widget/use-ticket-stage-badge', () => ({
  useTicketStageBadge: () => ({ hasTickets: ticketBadge.hasTickets }),
}))

// Every view is stubbed down to a marker plus the props the contract is about,
// so an assertion reads the landing and the payload and nothing else.
vi.mock('@/components/widget/widget-shell', () => ({
  WidgetShell: ({ children, activeTab }: { children: ReactNode; activeTab: string }) => (
    <div>
      <span data-testid="active-tab">{activeTab}</span>
      {children}
    </div>
  ),
}))
vi.mock('@/components/widget/widget-hero-backdrop', () => ({ WidgetHeroBackdrop: () => null }))
vi.mock('@/components/widget/widget-overview', () => ({
  WidgetOverview: () => <div data-testid="view-overview" />,
}))
vi.mock('@/components/widget/widget-home', () => ({
  WidgetHome: (props: Record<string, unknown>) => (
    <div data-testid="view-home">
      <span data-testid="compose-request">{JSON.stringify(props.composeRequest)}</span>
      <span data-testid="confirmed-board-slugs">{JSON.stringify(props.confirmedBoardSlugs)}</span>
      <span data-testid="initial-board-slug">{String(props.initialBoardSlug)}</span>
    </div>
  ),
}))
vi.mock('@/components/widget/widget-help', () => ({
  WidgetHelp: (props: {
    search?: string
    onCategorySelect?: (id: string, name: string, icon: string | null) => void
  }) => (
    <div data-testid="view-help">
      <span data-testid="help-search">{props.search}</span>
      <button type="button" onClick={() => props.onCategorySelect?.('cat_gated', 'Gated', null)}>
        open collection
      </button>
    </div>
  ),
}))
vi.mock('@/components/widget/widget-help-category', () => ({
  WidgetHelpCategory: (props: { categoryId: string; onCategoryUnavailable?: () => void }) => (
    <div data-testid="view-help-category">
      <span data-testid="help-category-id">{props.categoryId}</span>
      <button type="button" onClick={() => props.onCategoryUnavailable?.()}>
        lose collection
      </button>
    </div>
  ),
}))
vi.mock('@/components/widget/widget-help-detail', () => ({
  WidgetHelpDetail: ({ articleRef }: { articleRef: string }) => (
    <div data-testid="view-help-detail">{articleRef}</div>
  ),
}))
vi.mock('@/components/widget/widget-changelog', () => ({
  WidgetChangelog: () => <div data-testid="view-changelog" />,
}))
vi.mock('@/components/widget/widget-changelog-detail', () => ({
  WidgetChangelogDetail: ({ entryId }: { entryId: string }) => (
    <div data-testid="view-changelog-detail">{entryId}</div>
  ),
}))
vi.mock('@/components/widget/widget-messenger', () => ({
  WidgetMessenger: () => <div data-testid="view-messenger" />,
}))
vi.mock('@/components/widget/widget-messages', () => ({
  WidgetMessages: () => <div data-testid="view-messages" />,
}))
vi.mock('@/components/widget/widget-tickets', () => ({
  WidgetTickets: () => <div data-testid="view-tickets" />,
}))
vi.mock('@/components/widget/widget-post-detail', () => ({
  WidgetPostDetail: ({ postId }: { postId: string }) => (
    <div data-testid="view-post-detail">{postId}</div>
  ),
}))

import { Route } from '../index'

const ALL_TABS = {
  feedback: true,
  changelog: true,
  help: true,
  messages: true,
  tickets: true,
  home: true,
}

function loaderFixture(tabs: Partial<typeof ALL_TABS> = ALL_TABS) {
  return {
    posts: [],
    postsHasMore: false,
    statuses: [],
    boards: [
      { id: 'board_ideas', name: 'Ideas', slug: 'ideas' },
      { id: 'board_bugs', name: 'Bugs', slug: 'bug-reports' },
    ],
    orgSlug: 'acme',
    boardPermissions: { board_ideas: { canSubmit: true, canVote: true } },
    tabs,
    home: null,
    logoUrl: null,
    topArticles: [],
    teamName: 'Acme',
    team: [],
    assistant: null,
    linkPreviews: false,
    defaultBoard: 'ideas',
    portalAccess: { isPrivate: false, widgetSignIn: false },
    messengerEnabled: !!tabs.messages,
    portalOrigin: 'https://portal.example',
    showPoweredBy: false,
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

function mountWidget(tabs: Partial<typeof ALL_TABS> = ALL_TABS) {
  Object.assign(loaderData, loaderFixture(tabs))
  const WidgetRoute = Route.options.component as () => ReactNode
  return render(<WidgetRoute />, { wrapper })
}

/**
 * The SDK posts into the iframe, so the handler only trusts a message whose
 * `source` is the parent window. At the top level `window.parent === window`,
 * which is what makes a dispatched MessageEvent reach it.
 */
function sendOpen(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'quackback:open', data }, source: window })
    )
  })
}

describe('widget route — host open() commands', () => {
  beforeEach(() => {
    auth.sessionVersion = 0
    ticketBadge.hasTickets = null
    fetchBoardCapabilitiesFn.mockClear()
    fetchBoardCapabilitiesFn.mockResolvedValue({ permissions: {}, boards: [] })
    for (const key of Object.keys(loaderData)) delete loaderData[key]
    for (const key of Object.keys(searchData)) delete searchData[key]
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('expands the composer with the title, body and board the host sent (W1)', async () => {
    mountWidget()

    sendOpen({ view: 'new-post', title: 'Bug:', body: 'steps', board: 'bug-reports' })

    expect(await screen.findByTestId('active-tab')).toHaveProperty('textContent', 'feedback')
    expect(JSON.parse(screen.getByTestId('compose-request').textContent!)).toEqual({
      nonce: 1,
      title: 'Bug:',
      body: 'steps',
      boardSlug: 'bug-reports',
    })
  })

  it('opens the post the host named (W1)', async () => {
    mountWidget()

    sendOpen({ postId: 'post_01h' })

    expect((await screen.findByTestId('view-post-detail')).textContent).toBe('post_01h')
    expect(screen.getByTestId('active-tab').textContent).toBe('feedback')
  })

  it('opens an article by slug and by TypeID (W1)', async () => {
    mountWidget()

    sendOpen({ articleId: 'pricing' })
    expect((await screen.findByTestId('view-help-detail')).textContent).toBe('pricing')
    expect(screen.getByTestId('active-tab').textContent).toBe('help')

    // A TypeID is handed on untouched — the detail view resolves either form.
    sendOpen({ articleId: 'article_01hzzzzzzzzzzzzzzzzzzzzzzz' })
    await expect
      .poll(() => screen.getByTestId('view-help-detail').textContent)
      .toBe('article_01hzzzzzzzzzzzzzzzzzzzzzzz')
  })

  it('opens a changelog entry, and the list when no entry is named (W1)', async () => {
    mountWidget()

    sendOpen({ view: 'changelog', entryId: 'chg_01h' })
    expect((await screen.findByTestId('view-changelog-detail')).textContent).toBe('chg_01h')
    expect(screen.getByTestId('active-tab').textContent).toBe('changelog')

    sendOpen({ view: 'changelog' })
    expect(await screen.findByTestId('view-changelog')).toBeTruthy()
    expect(screen.queryByTestId('view-changelog-detail')).toBeNull()
  })

  it('opens help with the query the host sent (W1)', async () => {
    mountWidget()

    sendOpen({ view: 'help', query: 'refunds' })

    expect(await screen.findByTestId('view-help')).toBeTruthy()
    expect(screen.getByTestId('help-search').textContent).toBe('refunds')
    expect(screen.getByTestId('active-tab').textContent).toBe('help')
  })

  it('lands the messenger, tickets, messages and home commands on their tabs (W1)', async () => {
    mountWidget()

    sendOpen({ view: 'chat' })
    expect(await screen.findByTestId('view-messenger')).toBeTruthy()
    expect(screen.getByTestId('active-tab').textContent).toBe('messages')

    sendOpen({ view: 'tickets' })
    expect(await screen.findByTestId('view-tickets')).toBeTruthy()
    expect(screen.getByTestId('active-tab').textContent).toBe('tickets')

    sendOpen({ view: 'home' })
    expect(await screen.findByTestId('view-overview')).toBeTruthy()
    expect(screen.getByTestId('active-tab').textContent).toBe('home')
  })

  it('falls back to the messages list when the workspace has no Tickets tab (W1)', async () => {
    mountWidget({ ...ALL_TABS, tickets: false })

    sendOpen({ view: 'tickets' })

    expect(await screen.findByTestId('view-messages')).toBeTruthy()
    expect(screen.getByTestId('active-tab').textContent).toBe('messages')
  })

  it('ignores a view the workspace has not enabled, and an unknown one (W1)', async () => {
    mountWidget({ feedback: true, changelog: true, help: false, home: true })
    expect(await screen.findByTestId('view-overview')).toBeTruthy()

    sendOpen({ view: 'help', query: 'refunds' })
    expect(screen.queryByTestId('view-help')).toBeNull()
    expect(screen.getByTestId('active-tab').textContent).toBe('home')

    sendOpen({ articleId: 'pricing' })
    expect(screen.queryByTestId('view-help-detail')).toBeNull()

    sendOpen({ view: 'billing' })
    expect(screen.getByTestId('active-tab').textContent).toBe('home')
    expect(screen.getByTestId('view-overview')).toBeTruthy()
  })

  it('re-applies a repeated new-post command through a fresh nonce (W2)', async () => {
    mountWidget()

    sendOpen({ view: 'new-post', title: 'Bug:', board: 'bug-reports' })
    const first = JSON.parse((await screen.findByTestId('compose-request')).textContent!)

    // The visitor navigates away and the host repeats the identical command.
    sendOpen({ view: 'help' })
    expect(await screen.findByTestId('view-help')).toBeTruthy()
    sendOpen({ view: 'new-post', title: 'Bug:', board: 'bug-reports' })

    const second = JSON.parse(screen.getByTestId('compose-request').textContent!)
    expect(screen.getByTestId('active-tab').textContent).toBe('feedback')
    expect(second.nonce).toBe(first.nonce + 1)
    expect({ ...second, nonce: 0 }).toEqual({ ...first, nonce: 0 })
  })

  it('hands Home the board slugs this session actually confirmed (W4)', async () => {
    mountWidget()

    // The anonymous first paint is seeded from the loader's own board list.
    expect(JSON.parse((await screen.findByTestId('confirmed-board-slugs')).textContent!)).toEqual([
      'ideas',
      'bug-reports',
    ])
  })

  it('replaces the seeded board slugs once the identified fetch lands (W4)', async () => {
    fetchBoardCapabilitiesFn.mockResolvedValue({
      permissions: { board_secret: { canSubmit: true, canVote: true } },
      boards: [{ id: 'board_secret', name: 'Secret', slug: 'members-only' }],
    })
    auth.sessionVersion = 1
    mountWidget()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchBoardCapabilitiesFn).toHaveBeenCalled()
    await expect
      .poll(() => screen.getByTestId('confirmed-board-slugs').textContent)
      .toBe(JSON.stringify(['members-only']))
  })

  it('passes the SDK ?board= filter through to Home (W4)', async () => {
    Object.assign(searchData, { board: 'bug-reports' })
    mountWidget()

    expect((await screen.findByTestId('initial-board-slug')).textContent).toBe('bug-reports')
  })

  it('returns to help when the collection the visitor is in becomes unavailable (W9)', async () => {
    mountWidget()

    sendOpen({ view: 'help' })
    fireEvent.click(await screen.findByText('open collection'))
    expect((await screen.findByTestId('help-category-id')).textContent).toBe('cat_gated')

    fireEvent.click(screen.getByText('lose collection'))

    expect(await screen.findByTestId('view-help')).toBeTruthy()
    expect(screen.queryByTestId('view-help-category')).toBeNull()
  })
})
