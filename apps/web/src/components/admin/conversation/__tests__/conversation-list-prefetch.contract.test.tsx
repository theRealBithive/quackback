// @vitest-environment happy-dom
/**
 * Hover prefetching in the inbox list: which hovers are worth a request.
 *
 * The pick warms a row's thread while the pointer is still on the row, so the
 * pane is already full when the row is clicked. The cost of getting it wrong
 * is a request per row the pointer crosses — a single flick down a hundred-row
 * list — so resting is what counts, not entering.
 *
 * Contract for the batch E pick (upstream #553, `f8062929a`) — the confirmed
 * list; the whole of it is in
 * `lib/client/conversation/__tests__/reconcile-cached-thread.contract.test.ts`:
 *
 *   E12 A thread is warmed only when the pointer actually rests on its row. A
 *       pointer sweeping the list warms nothing, and a row left before the
 *       pointer rests warms nothing either. Nothing is left running when the
 *       list goes away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { generateId } from '@quackback/ids'
import type { PrincipalId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { IntlWrapper } from '@/test/render-with-intl'
import { ConversationListColumn } from '../conversation-list-column'

// The column itself only reads the route context; the refinement controls
// below it reach for the router's navigation helpers.
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ userRole: 'admin' }),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ pathname: '/admin/inbox', search: {} }),
  useParams: () => ({}),
  useSearch: () => ({}),
  Link: ({ children }: { children?: unknown }) => children,
}))

vi.mock('@/lib/client/hooks/use-activation-action', () => ({
  useActivationAction: () => null,
}))

// Real ids: the row's hover handler resolves the id back to a kind before it
// warms anything, so a made-up string would quietly warm nothing and every
// assertion below would pass by accident.
const CONVERSATION_ID = generateId('conversation')
const TICKET_ID = generateId('ticket')

function conversationItem(): InboxItemDTO {
  const conversation = {
    id: CONVERSATION_ID,
    status: 'open',
    priority: 'none',
    channel: 'messenger',
    subject: null,
    lastMessagePreview: 'Where is my order?',
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    visitor: {
      principalId: 'principal_visitor' as PrincipalId,
      displayName: 'Rita Visitor',
      avatarUrl: null,
    },
    assignedAgent: null,
    unreadCount: 0,
    visitorLastReadAt: null,
    agentLastReadAt: null,
    csatRating: null,
    visitorEmail: null,
    resolvedAt: null,
    endReason: null,
    endNote: null,
    snoozedUntil: null,
    tags: [],
  } as unknown as ConversationDTO
  return { kind: 'conversation', conversation, linkedTicket: null, searchSnippet: null }
}

function ticketItem(): InboxItemDTO {
  return {
    kind: 'ticket',
    unreadCount: 0,
    ticket: {
      id: TICKET_ID,
      number: 7,
      title: 'Broken lamp',
      type: 'customer',
      status: 'open',
      priority: 'none',
      assignee: { principalId: 'principal_agent', displayName: 'Maya Chen', avatarUrl: null },
      stage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  } as unknown as InboxItemDTO
}

function renderList(items: InboxItemDTO[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined)

  const result = render(
    <QueryClientProvider client={queryClient}>
      <IntlWrapper>
        <ConversationListColumn
          nav={{ kind: 'view', view: 'all' }}
          onSelectNav={() => {}}
          scopeLabel="All"
          showRefinements
          searchInput=""
          onSearchInput={() => {}}
          facet="open"
          onFacet={() => {}}
          priorityFilter="all"
          onPriorityFilter={() => {}}
          sort="recent"
          onSort={() => {}}
          loading={false}
          items={items}
          selectedId={null}
          onSelect={() => {}}
        />
      </IntlWrapper>
    </QueryClientProvider>
  )
  return { ...result, prefetch }
}

/** The row's own button — the one carrying the hover handlers. */
function rowButton(name: string): HTMLElement {
  const label = screen.getByText(name)
  const button = label.closest('button')
  if (!button) throw new Error(`no row button around "${name}"`)
  return button
}

/** Every query key the list asked to have warmed. */
function warmedKeys(prefetch: { mock: { calls: unknown[][] } }): string {
  return JSON.stringify(
    prefetch.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey)
  )
}

/** How long the pointer rests before the warm-up is due, and just after. */
const JUST_BEFORE_RESTING = 119
const A_MOMENT_LONGER = 10

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('hover prefetching in the inbox list (E12)', () => {
  it('warms a conversation the pointer rests on', () => {
    const { prefetch } = renderList([conversationItem()])

    act(() => {
      fireEvent.mouseOver(rowButton('Rita Visitor'))
      vi.advanceTimersByTime(JUST_BEFORE_RESTING)
    })
    expect(prefetch).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(A_MOMENT_LONGER)
    })
    expect(warmedKeys(prefetch)).toContain(CONVERSATION_ID)
  })

  it('warms both halves of a ticket the pointer rests on', () => {
    const { prefetch } = renderList([ticketItem()])

    act(() => {
      fireEvent.mouseOver(rowButton('Broken lamp'))
      vi.advanceTimersByTime(JUST_BEFORE_RESTING + A_MOMENT_LONGER)
    })

    // The thread and the ticket's own properties are two caches, and the pane
    // needs both to render without a second wait.
    expect(prefetch).toHaveBeenCalledTimes(2)
    expect(warmedKeys(prefetch)).toContain(TICKET_ID)

    // A ticket reached by keyboard warms the same two caches; the list is
    // navigable without a pointer and must not be slower for it.
    act(() => {
      fireEvent.focus(rowButton('Broken lamp'))
      vi.advanceTimersByTime(JUST_BEFORE_RESTING + A_MOMENT_LONGER)
    })
    expect(prefetch).toHaveBeenCalledTimes(4)
  })

  it('warms nothing for a pointer that sweeps past the row', () => {
    const { prefetch } = renderList([conversationItem()])
    const row = rowButton('Rita Visitor')

    act(() => {
      fireEvent.mouseOver(row)
      vi.advanceTimersByTime(JUST_BEFORE_RESTING)
      fireEvent.mouseOut(row)
      vi.advanceTimersByTime(10_000)
    })

    expect(prefetch).not.toHaveBeenCalled()
  })

  it('warms a row the keyboard rests on, and drops it again on the way out', () => {
    const { prefetch } = renderList([conversationItem()])
    const row = rowButton('Rita Visitor')

    act(() => {
      fireEvent.focus(row)
      vi.advanceTimersByTime(JUST_BEFORE_RESTING + A_MOMENT_LONGER)
    })
    expect(prefetch).toHaveBeenCalledTimes(1)

    act(() => {
      fireEvent.focus(row)
      fireEvent.blur(row)
      vi.advanceTimersByTime(10_000)
    })
    expect(prefetch).toHaveBeenCalledTimes(1)
  })

  it('leaves nothing running when the list goes away', () => {
    const { prefetch, unmount } = renderList([conversationItem()])

    act(() => {
      fireEvent.mouseOver(rowButton('Rita Visitor'))
      vi.advanceTimersByTime(JUST_BEFORE_RESTING)
    })
    unmount()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(prefetch).not.toHaveBeenCalled()
  })
})
