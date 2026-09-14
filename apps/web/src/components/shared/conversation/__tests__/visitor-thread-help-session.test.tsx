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

const getMyConversationFn = vi.fn(async () => ({ conversation: null, teamName: 'Acme' }))
const listConversationMessagesFn = vi.fn(async () => ({ items: [], hasMore: false }))
vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationFn: (...args: unknown[]) => getMyConversationFn(...(args as [])),
  listConversationMessagesFn: (...args: unknown[]) => listConversationMessagesFn(...(args as [])),
  sendConversationMessageFn: vi.fn(),
  mintConversationStreamTokenFn: vi.fn(async () => ({ token: null })),
  submitCsatFn: vi.fn(),
  markConversationReadFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  getConversationLinkedTicketFn: vi.fn(async () => null),
}))
vi.mock('@/lib/server/functions/widget-capabilities', () => ({
  getWidgetCapabilitiesFn: vi.fn(async () => ({
    chat: { mode: 'poll', pollIntervalMs: 60_000 },
  })),
}))
vi.mock('@/lib/client/hooks/use-conversation-stream', () => ({
  useConversationStream: () => undefined,
}))

/** The composer's editor, reduced to a textarea that reports a TipTap doc. */
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ onChange }: { onChange: (json: unknown, html: string) => void }) => (
    <textarea
      aria-label="composer"
      onChange={(e) =>
        onChange(
          {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }],
          },
          `<p>${e.target.value}</p>`
        )
      }
    />
  ),
}))

import { VisitorConversationThread } from '../visitor-conversation-thread'

const PRESENCE = { agentsOnline: true, withinOfficeHours: true, nextOpenAt: null }

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

const helpSearch = {
  search: vi.fn(async () => [{ slug: 'refunds', title: 'How refunds work' }]),
  onSelect: vi.fn(),
}

function renderThread(sessionVersion: number) {
  return render(
    <VisitorConversationThread
      conversationTarget="new"
      sessionVersion={sessionVersion}
      uploadImage={async () => 'https://example.test/image.png'}
      presence={PRESENCE}
      helpSearch={helpSearch}
      showHeader={false}
    />,
    { wrapper }
  )
}

describe('VisitorConversationThread — help deflection across a session change', () => {
  beforeEach(() => {
    helpSearch.search.mockClear()
    helpSearch.onSelect.mockClear()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('drops the suggested articles when the session changes (W7)', async () => {
    const { rerender } = renderThread(1)

    const composer = await screen.findByLabelText('composer')
    fireEvent.change(composer, { target: { value: 'refund please' } })

    expect(await screen.findByText('How refunds work')).toBeTruthy()

    // identify()/logout re-keys the surface: another visitor must not inherit
    // the articles this one's draft produced.
    rerender(
      <VisitorConversationThread
        conversationTarget="new"
        sessionVersion={2}
        uploadImage={async () => 'https://example.test/image.png'}
        presence={PRESENCE}
        helpSearch={helpSearch}
        showHeader={false}
      />
    )

    // The draft itself is untouched — the send control stays enabled because
    // `composer.text` still holds it — so the older effect, which only reruns on
    // the draft, the conversation or the message count, cannot be what cleared
    // the suggestions. Only the session dependency can.
    expect(screen.getByLabelText('Send').hasAttribute('disabled')).toBe(false)
    await waitFor(() => expect(screen.queryByText('How refunds work')).toBeNull())
  })
})
