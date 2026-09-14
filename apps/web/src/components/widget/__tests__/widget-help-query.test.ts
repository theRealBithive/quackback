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
import { describe, expect, it, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'

const listPublicCategoriesFn = vi.fn(async () => [{ id: 'cat_public' }])
const listPublicArticlesForCategoryFn = vi.fn(async () => [{ slug: 'pricing' }])
vi.mock('@/lib/server/functions/help-center', () => ({
  listPublicCategoriesFn: (...args: unknown[]) => listPublicCategoriesFn(...(args as [])),
  listPublicArticlesForCategoryFn: (...args: unknown[]) =>
    listPublicArticlesForCategoryFn(...(args as [])),
}))

const widgetAuthHeaders = { Authorization: 'Bearer widget-token' }
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => widgetAuthHeaders,
}))

import {
  shouldLeaveUnavailableHelpCategory,
  widgetHelpCategoriesQuery,
  widgetHelpCategoryArticlesQuery,
} from '../widget-help-query'

describe('shouldLeaveUnavailableHelpCategory', () => {
  it('leaves once the live session list no longer contains the id (W9)', () => {
    expect(shouldLeaveUnavailableHelpCategory('secret', [{ id: 'public' }], 1)).toBe(true)
    expect(shouldLeaveUnavailableHelpCategory('public', [{ id: 'public' }], 1)).toBe(false)
  })

  it('waits until the current session list is in (W9)', () => {
    expect(shouldLeaveUnavailableHelpCategory('secret', undefined, 1)).toBe(false)
  })

  it('does not bounce on the anonymous first paint (W9)', () => {
    expect(
      shouldLeaveUnavailableHelpCategory('secret', [{ id: 'public' }], INITIAL_SESSION_VERSION)
    ).toBe(false)
  })
})

describe('widget help collections carry the widget identity', () => {
  beforeEach(() => {
    listPublicCategoriesFn.mockClear()
    listPublicArticlesForCategoryFn.mockClear()
  })

  it('keys the collection list by session and locale and sends the widget Bearer (W6)', async () => {
    const options = widgetHelpCategoriesQuery(7, 'de')

    expect(options.queryKey).toEqual(['widget', 'help', 'categories', 'de', 7])

    await options.queryFn!({} as never)

    expect(listPublicCategoriesFn).toHaveBeenCalledWith({
      data: { locale: 'de' },
      headers: widgetAuthHeaders,
    })
  })

  it("keys a collection's articles by category, session and locale and sends the widget Bearer (W6)", async () => {
    const options = widgetHelpCategoryArticlesQuery('cat_gated', 3, 'fr')

    expect(options.queryKey).toEqual(['widget', 'help', 'category-articles', 'cat_gated', 'fr', 3])

    await options.queryFn!({} as never)

    expect(listPublicArticlesForCategoryFn).toHaveBeenCalledWith({
      data: { categoryId: 'cat_gated', locale: 'fr' },
      headers: widgetAuthHeaders,
    })
  })

  it('separates two identities, and only them, into different cache entries (W6)', () => {
    const locales = ['en', 'de', 'fr', 'ar'] as const
    fc.assert(
      fc.property(
        fc.integer({ min: INITIAL_SESSION_VERSION, max: INITIAL_SESSION_VERSION + 4 }),
        fc.integer({ min: INITIAL_SESSION_VERSION, max: INITIAL_SESSION_VERSION + 4 }),
        fc.constantFrom(...locales),
        fc.constantFrom(...locales),
        fc.constantFrom('cat_public', 'cat_gated'),
        (sessionA, sessionB, localeA, localeB, categoryId) => {
          const sameIdentity = sessionA === sessionB && localeA === localeB
          const listA = widgetHelpCategoriesQuery(sessionA, localeA).queryKey
          const listB = widgetHelpCategoriesQuery(sessionB, localeB).queryKey
          const articlesA = widgetHelpCategoryArticlesQuery(categoryId, sessionA, localeA).queryKey
          const articlesB = widgetHelpCategoryArticlesQuery(categoryId, sessionB, localeB).queryKey

          expect(JSON.stringify(listA) === JSON.stringify(listB)).toBe(sameIdentity)
          expect(JSON.stringify(articlesA) === JSON.stringify(articlesB)).toBe(sameIdentity)
          // The two collections never collide with each other, whatever the identity.
          expect(JSON.stringify(listA)).not.toBe(JSON.stringify(articlesA))
        }
      )
    )
  })
})
