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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const generateOneTimeToken = vi.fn(async () => 'ott-123')
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => WIDGET_HEADERS,
  generateOneTimeToken: () => generateOneTimeToken(),
}))

const sendToHost = vi.fn()
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: (msg: unknown) => sendToHost(msg) }))

const listPublicCategoriesFn = vi.fn()
const listPublicArticlesForCategoryFn = vi.fn()
const resolvePublicArticleRefFn = vi.fn()
vi.mock('@/lib/server/functions/help-center', () => ({
  listPublicCategoriesFn: (...args: unknown[]) => listPublicCategoriesFn(...(args as [])),
  listPublicArticlesForCategoryFn: (...args: unknown[]) =>
    listPublicArticlesForCategoryFn(...(args as [])),
  resolvePublicArticleRefFn: (...args: unknown[]) => resolvePublicArticleRefFn(...(args as [])),
}))

// Ask AI and KB search are their own modules with their own suites; here only
// the identity they are handed matters.
const askAiAvailableArgs: unknown[][] = []
const askAiControllerArgs: unknown[][] = []
vi.mock('@/components/help-center/ask-ai', () => ({
  AskAiAnswerPanel: () => null,
  AskAiRow: () => null,
  HighlightedText: ({ text }: { text: string }) => <>{text}</>,
  useAskAiAvailable: (...args: unknown[]) => {
    askAiAvailableArgs.push(args)
    return false
  },
  useAskAiSearchController: (...args: unknown[]) => {
    askAiControllerArgs.push(args)
    return {
      askAiState: { status: 'idle' },
      selectedIndex: -1,
      hasAskRow: false,
      answerOpen: false,
      askRowOffset: 0,
      triggerAsk: vi.fn(),
      dismissAnswer: vi.fn(),
      handleKeyDown: vi.fn(),
    }
  },
}))
const kbSearchArgs: unknown[][] = []
vi.mock('@/components/help-center/use-kb-search', () => ({
  useKbSearch: (...args: unknown[]) => {
    kbSearchArgs.push(args)
    return { results: [], isSearching: false }
  },
}))
vi.mock('../widget-article-footer', () => ({ WidgetArticleFooter: () => null }))

import { WidgetHelp } from '../widget-help'
import { WidgetHelpCategory } from '../widget-help-category'
import { WidgetHelpDetail } from '../widget-help-detail'

const CATEGORY_PUBLIC = {
  id: 'cat_public',
  name: 'Getting started',
  description: null,
  icon: null,
  slug: 'getting-started',
  articleCount: 2,
  parentId: null,
}
const CATEGORY_GATED = { ...CATEGORY_PUBLIC, id: 'cat_gated', name: 'Members', slug: 'members' }

const ARTICLE = {
  id: 'article_01hzzz',
  title: 'How refunds work',
  slug: 'how-refunds-work',
  urlId: 42,
  content: 'Plain text body',
  contentJson: null,
  resolvedLocale: 'de',
  category: { id: 'cat_public', name: 'Getting started', slug: 'getting-started' },
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
  askAiAvailableArgs.length = 0
  askAiControllerArgs.length = 0
  kbSearchArgs.length = 0
  sendToHost.mockClear()
  generateOneTimeToken.mockClear()
  listPublicCategoriesFn.mockReset().mockResolvedValue([CATEGORY_PUBLIC, CATEGORY_GATED])
  listPublicArticlesForCategoryFn.mockReset().mockResolvedValue([])
  resolvePublicArticleRefFn.mockReset().mockResolvedValue(ARTICLE)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('WidgetHelp', () => {
  it('fetches the collection list with the widget identity (W6)', async () => {
    render(<WidgetHelp />, { wrapper })

    await waitFor(() => expect(listPublicCategoriesFn).toHaveBeenCalled())
    expect(listPublicCategoriesFn).toHaveBeenCalledWith({
      data: { locale: 'en' },
      headers: WIDGET_HEADERS,
    })
  })

  it('hands help search and Ask AI the same identity and session (W6)', async () => {
    auth.sessionVersion = 5
    render(<WidgetHelp />, { wrapper })

    await waitFor(() => expect(kbSearchArgs.length).toBeGreaterThan(0))
    const searchOpts = kbSearchArgs[0][0] as { sessionVersion: number; getHeaders: () => unknown }
    expect(searchOpts.sessionVersion).toBe(5)
    expect(searchOpts.getHeaders()).toBe(WIDGET_HEADERS)

    const askOpts = askAiAvailableArgs[0][1] as {
      sessionVersion: number
      getHeaders: () => unknown
    }
    expect(askOpts.sessionVersion).toBe(5)
    expect(askOpts.getHeaders()).toBe(WIDGET_HEADERS)

    const controllerOpts = askAiControllerArgs[0][0] as {
      sessionVersion: number
      getHeaders: () => unknown
    }
    expect(controllerOpts.sessionVersion).toBe(5)
    expect(controllerOpts.getHeaders()).toBe(WIDGET_HEADERS)
  })

  it('refetches the collection list when the session changes (W6)', async () => {
    const { rerender } = render(<WidgetHelp />, { wrapper })
    await waitFor(() => expect(listPublicCategoriesFn).toHaveBeenCalledTimes(1))

    auth.sessionVersion = 1
    rerender(<WidgetHelp />)

    await waitFor(() => expect(listPublicCategoriesFn).toHaveBeenCalledTimes(2))
  })
})

describe('WidgetHelpCategory', () => {
  function renderCategory(onCategoryUnavailable?: () => void) {
    return render(
      <WidgetHelpCategory
        categoryId="cat_gated"
        categoryName="Members"
        categoryIcon={null}
        onArticleSelect={vi.fn()}
        onCategoryUnavailable={onCategoryUnavailable}
      />,
      { wrapper }
    )
  }

  it("fetches a collection's articles with the widget identity (W6)", async () => {
    auth.sessionVersion = 3
    renderCategory()

    await waitFor(() => expect(listPublicArticlesForCategoryFn).toHaveBeenCalled())
    expect(listPublicArticlesForCategoryFn).toHaveBeenCalledWith({
      data: { categoryId: 'cat_gated', locale: 'en' },
      headers: WIDGET_HEADERS,
    })
  })

  it('leaves a collection the new session can no longer see (W9)', async () => {
    auth.sessionVersion = 2
    listPublicCategoriesFn.mockResolvedValue([CATEGORY_PUBLIC])
    const onCategoryUnavailable = vi.fn()
    renderCategory(onCategoryUnavailable)

    await waitFor(() => expect(onCategoryUnavailable).toHaveBeenCalled())
  })

  it('stays put while the collection is still on this session’s list (W9)', async () => {
    auth.sessionVersion = 2
    const onCategoryUnavailable = vi.fn()
    renderCategory(onCategoryUnavailable)

    // Wait for the list to have actually arrived: the heading is the prop and
    // renders either way, so a DOM wait would pass on a query that never settled
    // and never reached the decision at all.
    await waitFor(() =>
      expect(queryClient.getQueryState(['widget', 'help', 'categories', 'en', 2])?.status).toBe(
        'success'
      )
    )
    expect(onCategoryUnavailable).not.toHaveBeenCalled()
  })

  it('does nothing before the collection list has loaded (W9)', async () => {
    auth.sessionVersion = 2
    listPublicCategoriesFn.mockImplementation(() => new Promise(() => {}))
    const onCategoryUnavailable = vi.fn()
    renderCategory(onCategoryUnavailable)

    await waitFor(() => expect(listPublicArticlesForCategoryFn).toHaveBeenCalled())
    expect(onCategoryUnavailable).not.toHaveBeenCalled()
  })
})

describe('WidgetHelpDetail', () => {
  it('resolves the article ref with the widget identity and the active locale (W6)', async () => {
    auth.sessionVersion = 4
    render(<WidgetHelpDetail articleRef="article_01hzzz" />, { wrapper })

    await waitFor(() => expect(resolvePublicArticleRefFn).toHaveBeenCalled())
    expect(resolvePublicArticleRefFn).toHaveBeenCalledWith({
      data: { ref: 'article_01hzzz', locale: 'en' },
      headers: WIDGET_HEADERS,
    })
    expect(await screen.findByText('How refunds work')).toBeTruthy()
  })

  it('does not show one identity’s article while the next one loads (W6)', async () => {
    const { rerender } = render(<WidgetHelpDetail articleRef="article_01hzzz" />, { wrapper })
    expect(await screen.findByText('How refunds work')).toBeTruthy()

    // A logout re-keys the query; the previous actor's article must not be
    // reused as a placeholder while the new fetch is in flight.
    resolvePublicArticleRefFn.mockImplementation(() => new Promise(() => {}))
    auth.sessionVersion = 1
    rerender(<WidgetHelpDetail articleRef="article_01hzzz" />)

    await waitFor(() => expect(screen.queryByText('How refunds work')).toBeNull())
  })

  it('carries a one-time token to the portal for an identified visitor (W8)', async () => {
    auth.isIdentified = true
    render(<WidgetHelpDetail articleRef="article_01hzzz" />, { wrapper })
    fireEvent.click(await screen.findByText('How refunds work'))

    await waitFor(() => expect(sendToHost).toHaveBeenCalled())
    const { url } = sendToHost.mock.calls[0][0] as { url: string }
    // The locale the article resolved in, not the one that was asked for.
    expect(url).toContain('/hc/de/articles/42-how-refunds-work')
    expect(new URL(url).searchParams.get('ott')).toBe('ott-123')
  })

  it('carries no token to the portal for an anonymous visitor (W8)', async () => {
    render(<WidgetHelpDetail articleRef="article_01hzzz" />, { wrapper })
    fireEvent.click(await screen.findByText('How refunds work'))

    await waitFor(() => expect(sendToHost).toHaveBeenCalled())
    const { url } = sendToHost.mock.calls[0][0] as { url: string }
    expect(url).toContain('/hc/de/articles/42-how-refunds-work')
    expect(new URL(url).searchParams.get('ott')).toBeNull()
    expect(generateOneTimeToken).not.toHaveBeenCalled()
  })
})
