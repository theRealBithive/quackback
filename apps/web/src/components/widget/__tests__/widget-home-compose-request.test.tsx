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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const auth = { sessionVersion: 0, isIdentified: false }
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    ensureSession: vi.fn(),
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
    isIdentified: auth.isIdentified,
    hmacRequired: false,
    user: null,
    emitEvent: vi.fn(),
    metadata: null,
    getSessionVersion: () => auth.sessionVersion,
    sessionVersion: auth.sessionVersion,
  }),
}))

const WIDGET_HEADERS = { Authorization: 'Bearer widget-token' }
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => WIDGET_HEADERS,
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ value }: { value?: unknown }) => (
    <div data-testid="editor">{JSON.stringify(value)}</div>
  ),
}))
vi.mock('../use-widget-image-upload', () => ({
  useWidgetImageUpload: () => ({ upload: vi.fn() }),
  WidgetSessionError: class WidgetSessionError extends Error {},
}))
vi.mock('../widget-vote-button', () => ({ WidgetVoteButton: () => null }))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({
  useInfiniteScroll: () => ({ current: null }),
}))
vi.mock('@/lib/server/functions/public-posts', () => ({
  listPublicPostsFn: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
}))

import { INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'
import { WidgetHomeAnimated } from '../widget-home-animated'
import type { WidgetComposeRequest } from '../widget-compose'

const BOARDS = {
  ideas: { id: 'board_ideas', name: 'Ideas', slug: 'ideas' },
  bugs: { id: 'board_bugs', name: 'Bugs', slug: 'bug-reports' },
  gated: { id: 'board_gated', name: 'Members', slug: 'members-only' },
}

const PERMISSIONS = {
  board_ideas: { canSubmit: true, canVote: true },
  board_bugs: { canSubmit: true, canVote: true },
  board_gated: { canSubmit: true, canVote: true },
}

type HomeProps = Parameters<typeof WidgetHomeAnimated>[0]

function homeProps(overrides: Partial<HomeProps> = {}): HomeProps {
  return {
    initialPosts: [],
    initialHasMore: false,
    statuses: [],
    boards: [BOARDS.ideas, BOARDS.bugs],
    boardPermissions: PERMISSIONS,
    defaultBoard: 'ideas',
    ...overrides,
  } as HomeProps
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

function composeRequest(nonce: number, rest: Omit<WidgetComposeRequest, 'nonce'> = {}) {
  return { nonce, ...rest }
}

function titleInput() {
  return screen.getByLabelText('Feedback title')
}

function boardSelect(container: HTMLElement) {
  const select = container.querySelector('select')
  if (!select) throw new Error('compose board picker is not rendered')
  return select
}

/** The search response the similar-post fetch reads. */
function searchResponse(titles: string[], ok = true) {
  return {
    ok,
    json: async () => ({
      data: {
        posts: titles.map((title, i) => ({
          id: `post_${title}_${i}`,
          title,
          voteCount: 0,
          statusId: null,
          commentCount: 0,
          board: BOARDS.ideas,
        })),
      },
    }),
  }
}

let fetchMock: ReturnType<typeof vi.fn>

describe('WidgetHomeAnimated — host compose requests and session-scoped feeds', () => {
  beforeEach(() => {
    // The similar-search cache is a module-level singleton keyed by session, so
    // each test starts on a session of its own rather than on a cleared cache.
    auth.sessionVersion += 10
    auth.isIdentified = false
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetchMock = vi.fn(async () => searchResponse([]))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('expands the composer and prefills title, body and board from the command (W1)', async () => {
    const { container } = render(
      <WidgetHomeAnimated
        {...homeProps({
          composeRequest: composeRequest(1, {
            title: 'Dark mode',
            body: 'line one\nline two',
            boardSlug: 'bug-reports',
          }),
        })}
      />,
      { wrapper }
    )

    expect(titleInput()).toHaveProperty('value', 'Dark mode')
    const editor = await screen.findByTestId('editor')
    expect(editor.textContent).toContain('line one')
    expect(editor.textContent).toContain('line two')
    expect(boardSelect(container).value).toBe('board_bugs')
  })

  it('reapplies an identical second command because the nonce is the trigger (W2)', async () => {
    const request = { title: 'Dark mode', boardSlug: 'bug-reports' }
    const { container, rerender } = render(
      <WidgetHomeAnimated {...homeProps({ composeRequest: composeRequest(1, request) })} />,
      { wrapper }
    )

    // The visitor edits the command away: another title, another board.
    fireEvent.change(titleInput(), { target: { value: 'Something else' } })
    fireEvent.change(boardSelect(container), { target: { value: 'board_ideas' } })
    expect(boardSelect(container).value).toBe('board_ideas')

    rerender(<WidgetHomeAnimated {...homeProps({ composeRequest: composeRequest(2, request) })} />)

    expect(titleInput()).toHaveProperty('value', 'Dark mode')
    expect(boardSelect(container).value).toBe('board_bugs')
  })

  it('applies a requested board once identify makes it visible (W3)', async () => {
    const request = { title: 'Gated idea', boardSlug: 'members-only' }
    const { container, rerender } = render(
      <WidgetHomeAnimated {...homeProps({ composeRequest: composeRequest(1, request) })} />,
      { wrapper }
    )

    // Anonymous: the slug is not on the visible list, so the default wins.
    expect(boardSelect(container).value).toBe('board_ideas')

    auth.sessionVersion += 1
    rerender(
      <WidgetHomeAnimated
        {...homeProps({
          composeRequest: composeRequest(1, request),
          boards: [BOARDS.ideas, BOARDS.bugs, BOARDS.gated],
          confirmedBoardSlugs: ['ideas', 'bug-reports', 'members-only'],
        })}
      />
    )

    expect(boardSelect(container).value).toBe('board_gated')
  })

  it('never overwrites a board the visitor picked after the command (W3)', async () => {
    const request = { title: 'Gated idea', boardSlug: 'members-only' }
    const { container, rerender } = render(
      <WidgetHomeAnimated {...homeProps({ composeRequest: composeRequest(1, request) })} />,
      { wrapper }
    )

    fireEvent.change(boardSelect(container), { target: { value: 'board_bugs' } })

    auth.sessionVersion += 1
    rerender(
      <WidgetHomeAnimated
        {...homeProps({
          composeRequest: composeRequest(1, request),
          boards: [BOARDS.ideas, BOARDS.bugs, BOARDS.gated],
          confirmedBoardSlugs: ['ideas', 'bug-reports', 'members-only'],
        })}
      />
    )

    expect(boardSelect(container).value).toBe('board_bugs')
  })

  it('keeps a compose board the anonymous first paint cannot confirm (W4)', async () => {
    // The one test that runs on the initial session — the effect it is about
    // reads INITIAL_SESSION_VERSION as "identify may still grant this".
    auth.sessionVersion = INITIAL_SESSION_VERSION
    const request = { title: 'Gated first paint', boardSlug: 'members-only' }
    const boards = [BOARDS.ideas, BOARDS.bugs, BOARDS.gated]
    const { container, rerender } = render(
      <WidgetHomeAnimated {...homeProps({ boards, composeRequest: composeRequest(1, request) })} />,
      { wrapper }
    )
    expect(boardSelect(container).value).toBe('board_gated')

    rerender(
      <WidgetHomeAnimated
        {...homeProps({
          boards,
          composeRequest: composeRequest(1, request),
          confirmedBoardSlugs: ['ideas', 'bug-reports'],
        })}
      />
    )

    expect(boardSelect(container).value).toBe('board_gated')
  })

  it("drops a compose board once this session's list says it cannot see it (W4)", async () => {
    const request = { title: 'Gated idea', boardSlug: 'members-only' }
    const boards = [BOARDS.ideas, BOARDS.bugs, BOARDS.gated]
    const { container, rerender } = render(
      <WidgetHomeAnimated {...homeProps({ boards, composeRequest: composeRequest(1, request) })} />,
      { wrapper }
    )
    expect(boardSelect(container).value).toBe('board_gated')

    // Logout: this session's list has arrived and does not contain the slug.
    rerender(
      <WidgetHomeAnimated
        {...homeProps({
          boards,
          composeRequest: composeRequest(1, request),
          confirmedBoardSlugs: ['ideas', 'bug-reports'],
        })}
      />
    )

    expect(boardSelect(container).value).toBe('board_ideas')
  })

  it('clears an SDK board filter the new session cannot see (W4)', async () => {
    const boards = [BOARDS.ideas, BOARDS.bugs, BOARDS.gated]
    const { rerender } = render(
      <WidgetHomeAnimated {...homeProps({ boards, initialBoardSlug: 'members-only' })} />,
      { wrapper }
    )

    const filteredCalls = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => JSON.stringify(q.queryKey).includes('members-only')).length

    expect(filteredCalls()).toBeGreaterThan(0)

    auth.sessionVersion += 1
    rerender(
      <WidgetHomeAnimated
        {...homeProps({ boards, initialBoardSlug: 'members-only', confirmedBoardSlugs: ['ideas'] })}
      />
    )

    await waitFor(() => {
      const keys = queryClient
        .getQueryCache()
        .getAll()
        .map((q) => JSON.stringify(q.queryKey))
      expect(keys.some((k) => k.includes(`"all",${auth.sessionVersion}`))).toBe(true)
    })
  })

  it('sends the widget identity with the popular-ideas search and re-keys it per session (W6)', async () => {
    render(<WidgetHomeAnimated {...homeProps()} />, { wrapper })

    fireEvent.click(screen.getByLabelText('Search ideas'))
    fireEvent.change(screen.getByLabelText('Search popular ideas'), {
      target: { value: 'dark' },
    })

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('q=dark'))
      expect(call).toBeDefined()
      expect((call![1] as RequestInit).headers).toBe(WIDGET_HEADERS)
    })

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey))
    expect(
      keys.some((k) => k.includes('"popular","dark"') && k.endsWith(`${auth.sessionVersion}]`))
    ).toBe(true)
  })

  it('keeps the previous hits on screen while refining, and drops them on a session change (W5)', async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      searchResponse(String(url).includes('q=dark') ? ['Dark mode please'] : [])
    )
    const { rerender } = render(<WidgetHomeAnimated {...homeProps()} />, { wrapper })

    fireEvent.click(screen.getByLabelText('Search ideas'))
    fireEvent.change(screen.getByLabelText('Search popular ideas'), { target: { value: 'dark' } })
    expect(await screen.findByText('Dark mode please')).toBeTruthy()

    auth.sessionVersion += 1
    fetchMock.mockImplementation(async () => searchResponse([]))
    rerender(<WidgetHomeAnimated {...homeProps()} />)

    await waitFor(() => expect(screen.queryByText('Dark mode please')).toBeNull())
  })
})

describe('WidgetHomeAnimated — the similar-post cache', () => {
  beforeEach(() => {
    auth.sessionVersion += 10
    auth.isIdentified = false
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetchMock = vi.fn(async () => searchResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Type a title, let the 300ms debounce elapse, and settle the fetch. */
  async function searchFor(title: string) {
    fireEvent.change(titleInput(), { target: { value: title } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
  }

  function similarSearchCalls() {
    return fetchMock.mock.calls.filter(([, init]) => !!init && 'signal' in (init as RequestInit))
  }

  it('serves a repeated title from the cache instead of searching again (W5)', async () => {
    render(<WidgetHomeAnimated {...homeProps()} />, { wrapper })

    fetchMock.mockImplementation(async () => searchResponse(['Dark mode already asked']))
    await searchFor('dark mode')
    expect(await screen.findByText('Dark mode already asked')).toBeTruthy()
    const afterFirst = similarSearchCalls().length

    await searchFor('')
    await searchFor('dark mode')

    expect(similarSearchCalls().length).toBe(afterFirst)
    expect(screen.getByText('Dark mode already asked')).toBeTruthy()
  })

  it('never serves one visitor a previous visitor’s hits (W5)', async () => {
    const { rerender } = render(<WidgetHomeAnimated {...homeProps()} />, { wrapper })

    fetchMock.mockImplementation(async () => searchResponse(['Private roadmap item']))
    await searchFor('roadmap')
    expect(await screen.findByText('Private roadmap item')).toBeTruthy()

    // Logout: the same query must go back to the server for this session.
    auth.sessionVersion += 1
    fetchMock.mockImplementation(async () => searchResponse(['Public roadmap item']))
    rerender(<WidgetHomeAnimated {...homeProps()} />)
    await searchFor('')
    await searchFor('roadmap')

    expect(await screen.findByText('Public roadmap item')).toBeTruthy()
    expect(screen.queryByText('Private roadmap item')).toBeNull()
  })

  it('holds at most 40 queries and drops the oldest first (W5)', async () => {
    render(<WidgetHomeAnimated {...homeProps()} />, { wrapper })

    fetchMock.mockImplementation(async () => searchResponse([]))
    for (let i = 0; i < 41; i++) {
      await searchFor(`idea number ${i}`)
    }
    const afterFilling = similarSearchCalls().length

    // The newest query is still cached, and so is the oldest one that still
    // fits — together with the miss below that brackets the bound at 40 rather
    // than at "some number".
    await searchFor('')
    await searchFor('idea number 40')
    expect(similarSearchCalls().length).toBe(afterFilling)

    await searchFor('')
    await searchFor('idea number 1')
    expect(similarSearchCalls().length).toBe(afterFilling)

    // The 41st query pushed the very first one out.
    await searchFor('')
    await searchFor('idea number 0')
    expect(similarSearchCalls().length).toBe(afterFilling + 1)
  })

  it('shows no hits when the search fails rather than the previous ones (W5)', async () => {
    render(<WidgetHomeAnimated {...homeProps()} />, { wrapper })

    fetchMock.mockImplementation(async () => searchResponse(['Earlier hit']))
    await searchFor('earlier')
    expect(await screen.findByText('Earlier hit')).toBeTruthy()

    fetchMock.mockImplementation(async () => searchResponse([], false))
    await searchFor('later')

    await waitFor(() => expect(screen.queryByText('Earlier hit')).toBeNull())
  })

  it('shows no hits when the search throws rather than the previous ones (W5)', async () => {
    render(<WidgetHomeAnimated {...homeProps()} />, { wrapper })

    fetchMock.mockImplementation(async () => searchResponse(['Earlier hit']))
    await searchFor('earlier')
    expect(await screen.findByText('Earlier hit')).toBeTruthy()

    fetchMock.mockImplementation(async () => {
      throw new Error('network down')
    })
    await searchFor('later')

    await waitFor(() => expect(screen.queryByText('Earlier hit')).toBeNull())
  })
})
