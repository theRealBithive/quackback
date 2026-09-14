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
import { INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'

const listPublicChangelogsFn = vi.fn(async () => ({
  items: [{ id: 'chg_1' }],
  nextCursor: 'cursor-2',
}))
vi.mock('@/lib/server/functions/changelog', () => ({
  listPublicChangelogsFn: (...args: unknown[]) => listPublicChangelogsFn(...(args as [])),
}))

const widgetAuthHeaders = { Authorization: 'Bearer widget-token' }
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => widgetAuthHeaders,
}))

import {
  shouldClearUnavailableChangelogCategory,
  widgetChangelogListQuery,
} from '../widget-changelog-query'

describe('shouldClearUnavailableChangelogCategory', () => {
  const ready = { sessionVersion: 1, listReady: true, stillLooking: false }

  it('clears a filter the current session feed no longer contains (W10)', () => {
    expect(shouldClearUnavailableChangelogCategory('secret', [{ id: 'public' }], ready)).toBe(true)
    expect(shouldClearUnavailableChangelogCategory('public', [{ id: 'public' }], ready)).toBe(false)
    expect(shouldClearUnavailableChangelogCategory(null, [{ id: 'public' }], ready)).toBe(false)
  })

  it('waits until the feed is in and lookahead has finished (W10)', () => {
    expect(
      shouldClearUnavailableChangelogCategory('secret', [], {
        ...ready,
        listReady: false,
      })
    ).toBe(false)
    expect(
      shouldClearUnavailableChangelogCategory('secret', [], {
        ...ready,
        stillLooking: true,
      })
    ).toBe(false)
  })

  it('does not bounce on the anonymous first paint (W10)', () => {
    expect(
      shouldClearUnavailableChangelogCategory('secret', [], {
        ...ready,
        sessionVersion: INITIAL_SESSION_VERSION,
      })
    ).toBe(false)
  })
})

describe('widgetChangelogListQuery', () => {
  beforeEach(() => {
    listPublicChangelogsFn.mockClear()
  })

  it('keys the feed by session and sends the widget Bearer (W6)', async () => {
    const options = widgetChangelogListQuery(4)

    expect(options.queryKey).toEqual(['widget', 'changelogs', 4])
    expect(widgetChangelogListQuery(INITIAL_SESSION_VERSION).queryKey).not.toEqual(options.queryKey)

    await options.queryFn!({ pageParam: undefined } as never)

    expect(listPublicChangelogsFn).toHaveBeenCalledWith({
      data: { cursor: undefined, limit: 10 },
      headers: widgetAuthHeaders,
    })
  })

  it('follows the cursor the previous page reported, and stops when there is none (W6)', async () => {
    const options = widgetChangelogListQuery(4)

    await options.queryFn!({ pageParam: 'cursor-2' } as never)
    expect(listPublicChangelogsFn).toHaveBeenCalledWith({
      data: { cursor: 'cursor-2', limit: 10 },
      headers: widgetAuthHeaders,
    })

    expect(
      options.getNextPageParam(
        { items: [], nextCursor: 'cursor-3' } as never,
        [],
        undefined as never,
        []
      )
    ).toBe('cursor-3')
    expect(
      options.getNextPageParam({ items: [], nextCursor: null } as never, [], undefined as never, [])
    ).toBeUndefined()
  })
})
