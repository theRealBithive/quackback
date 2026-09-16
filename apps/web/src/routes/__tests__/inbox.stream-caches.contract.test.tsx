// @vitest-environment happy-dom
/**
 * What the inbox does with a live event, now that it no longer only patches
 * the thread that happens to be open.
 *
 * Before the pick, a frame for any conversation other than the selected one
 * was dropped on the floor. A row warmed by a hover therefore held whatever
 * the server said at hover time, for as long as the cache lived — the reader
 * opened it and read a thread that was already behind.
 *
 * Contract for the batch E pick (upstream #553, `f8062929a`) — the confirmed
 * list; the whole of it is in
 * `lib/client/conversation/__tests__/reconcile-cached-thread.contract.test.ts`:
 *
 *   E2 A thread that was hover-prefetched, or opened earlier and still
 *      cached, stays in step with the live stream: a message, read receipt,
 *      reaction or deletion that arrives after the prefetch is reflected when
 *      the row is finally selected.
 *   E5 No cache is created for a conversation nobody has looked at.
 *   E7 The first clean connection does not trigger a catch-up refetch. A
 *      connection that follows a failed attempt does, because that gap is the
 *      same gap a reconnect leaves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { generateId } from '@quackback/ids'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { ConversationStreamEvent } from '@/lib/shared/conversation/types'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { ticketKeys } from '@/lib/client/queries/inbox'
import { IntlWrapper } from '@/test/render-with-intl'
import { Route } from '../admin/inbox'

/** The options the page hands the stream hook, captured instead of connecting. */
const stream = vi.hoisted(() => ({
  onEvent: null as ((event: ConversationStreamEvent) => void) | null,
  onReconnect: null as (() => void) | null,
}))

vi.mock('@/lib/client/hooks/use-conversation-stream', () => ({
  useConversationStream: (options: {
    onEvent: (event: ConversationStreamEvent) => void
    onReconnect?: () => void
  }) => {
    stream.onEvent = options.onEvent
    stream.onReconnect = options.onReconnect ?? null
    return { connected: true }
  },
}))

const routeContext = {
  settings: { featureFlags: { supportInbox: true, supportTickets: true } },
  userRole: 'admin',
  permissions: [],
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => ({}),
    useRouteContext: () => routeContext,
    useNavigate: () => vi.fn(),
    useLoaderData: () => ({}),
    useParams: () => ({}),
  }),
  useRouteContext: () => routeContext,
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/admin/inbox', search: {} } }),
  Navigate: () => null,
  Outlet: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}))

/**
 * Renders the inbox with nothing selected, so every assertion below is about a
 * thread the reader is NOT looking at — the case the pick exists for.
 */
function renderInboxWithNothingSelected(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const InboxRoute = (Route as unknown as { options: { component: () => JSX.Element } }).options
    .component
  render(
    <QueryClientProvider client={queryClient}>
      <IntlWrapper>
        <InboxRoute />
      </IntlWrapper>
    </QueryClientProvider>
  )
  return queryClient
}

function messageEvent(conversationId: ConversationId, messageId: string): ConversationStreamEvent {
  return {
    kind: 'message',
    conversationId,
    message: {
      id: messageId,
      conversationId,
      body: 'The parcel never arrived.',
      senderType: 'visitor',
      createdAt: new Date().toISOString(),
      attachments: [],
    },
  } as unknown as ConversationStreamEvent
}

function cachedThread(conversationId: ConversationId) {
  return { conversation: { id: conversationId }, messages: [] }
}

beforeEach(() => {
  stream.onEvent = null
  stream.onReconnect = null
})

describe('live events against unopened thread caches (E2, E5)', () => {
  it('lands a message in a thread that was warmed but never selected', () => {
    const queryClient = renderInboxWithNothingSelected()
    const conversationId = generateId('conversation')
    queryClient.setQueryData(
      conversationKeys.agentThread(conversationId),
      cachedThread(conversationId)
    )

    stream.onEvent!(messageEvent(conversationId, 'conversation_msg_1'))

    const thread = queryClient.getQueryData(conversationKeys.agentThread(conversationId)) as {
      messages: Array<{ id: string }>
    }
    expect(thread.messages.map((message) => message.id)).toEqual(['conversation_msg_1'])
  })

  it('creates nothing for a conversation nobody has looked at', () => {
    const queryClient = renderInboxWithNothingSelected()
    const conversationId = generateId('conversation')

    stream.onEvent!(messageEvent(conversationId, 'conversation_msg_1'))

    expect(queryClient.getQueryData(conversationKeys.agentThread(conversationId))).toBeUndefined()
  })

  it('leaves a cached thread alone for an ephemeral typing frame', () => {
    const queryClient = renderInboxWithNothingSelected()
    const conversationId = generateId('conversation')
    const before = cachedThread(conversationId)
    queryClient.setQueryData(conversationKeys.agentThread(conversationId), before)

    stream.onEvent!({
      kind: 'typing',
      conversationId,
      side: 'visitor',
      at: new Date().toISOString(),
    } as ConversationStreamEvent)

    expect(queryClient.getQueryData(conversationKeys.agentThread(conversationId))).toBe(before)
  })

  it('lands a ticket message in a ticket thread that was warmed but never selected', () => {
    const queryClient = renderInboxWithNothingSelected()
    const ticketId = generateId('ticket') as TicketId
    queryClient.setQueryData(ticketKeys.thread(ticketId), {
      ticket: { id: ticketId },
      messages: [],
    })

    stream.onEvent!({
      kind: 'ticket_message',
      ticketId,
      message: {
        id: 'conversation_msg_2',
        body: 'Still broken.',
        senderType: 'visitor',
        createdAt: new Date().toISOString(),
        attachments: [],
      },
    } as unknown as ConversationStreamEvent)

    const thread = queryClient.getQueryData(ticketKeys.thread(ticketId)) as {
      messages: Array<{ id: string }>
    }
    expect(thread.messages.map((message) => message.id)).toEqual(['conversation_msg_2'])
  })

  it('seeds a ticket’s own properties from the event that changed them', () => {
    const queryClient = renderInboxWithNothingSelected()
    const ticketId = generateId('ticket') as TicketId
    const ticket = { id: ticketId, title: 'Broken lamp', status: 'open', priority: 'urgent' }

    stream.onEvent!({ kind: 'ticket_updated', ticket } as unknown as ConversationStreamEvent)

    expect(queryClient.getQueryData(ticketKeys.detail(ticketId))).toEqual(ticket)
  })
})

describe('catching up after a gap in the stream (E2, E7)', () => {
  it('marks every warmed thread stale, so none of them stays behind', () => {
    const queryClient = renderInboxWithNothingSelected()
    const conversationId = generateId('conversation')
    const ticketId = generateId('ticket') as TicketId
    queryClient.setQueryData(
      conversationKeys.agentThread(conversationId),
      cachedThread(conversationId)
    )
    queryClient.setQueryData(ticketKeys.thread(ticketId), {
      ticket: { id: ticketId },
      messages: [],
    })
    queryClient.setQueryData(ticketKeys.detail(ticketId), { id: ticketId })

    stream.onReconnect!()

    for (const key of [
      conversationKeys.agentThread(conversationId),
      ticketKeys.thread(ticketId),
      ticketKeys.detail(ticketId),
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    }
  })
})
